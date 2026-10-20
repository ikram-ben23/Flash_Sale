const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { setTimeout: delay } = require("node:timers/promises");
const { randomUUID } = require("node:crypto");
const { Pool } = require("pg");
require("dotenv").config();
let server, pool, base, userA, userB, tokenA, tokenB, product;
const canRun = Boolean(process.env.DATABASE_URL && process.env.JWT_SECRET && process.env.JWT_SECRET.length >= 32);
test("integration suite: auth, ownership, idempotency, sold-out and concurrency", { skip: !canRun }, async (t) => {
  pool = new Pool({ connectionString:process.env.DATABASE_URL, ssl:["1","true","yes"].includes(String(process.env.DATABASE_SSL).toLowerCase())?{rejectUnauthorized:false}:undefined });
  const port = 3100 + Math.floor(Math.random()*500);
  base = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, ["src/server.js"], { env:{...process.env,PORT:String(port),NODE_ENV:"test"}, stdio:"ignore" });
  try {
    let healthy=false;
    for(let i=0;i<60;i++){try{const r=await fetch(`${base}/api/v1/health`);if(r.ok){healthy=true;break;}}catch{} await delay(250);}
    assert.ok(healthy,"API server should start and connect to the test database");
    const suffix=randomUUID();
    const register=async(email)=>{const r=await fetch(`${base}/api/v1/auth/register`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({name:"Test User",email,password:"Correct-Horse-2026"})});assert.equal(r.status,201);return (await r.json()).data;};
    userA=await register(`a-${suffix}@example.test`);userB=await register(`b-${suffix}@example.test`);tokenA=userA.token;tokenB=userB.token;
    const p=await pool.query("INSERT INTO products(name,description,price_cents,currency,stock) VALUES($1,'Integration fixture',100,'USD',5) RETURNING id",[`test-${suffix}`]);product=p.rows[0];
    await t.test("reject order without token",async()=>{const r=await fetch(`${base}/api/v1/orders`,{method:"POST",headers:{"content-type":"application/json","Idempotency-Key":`no-token-${suffix}`},body:JSON.stringify({productId:product.id,quantity:1})});assert.equal(r.status,401);});
    await t.test("same idempotency key creates only one order",async()=>{const key=`retry-${suffix}`;const call=()=>fetch(`${base}/api/v1/orders`,{method:"POST",headers:{"content-type":"application/json","Authorization":`Bearer ${tokenA}`,"Idempotency-Key":key},body:JSON.stringify({productId:product.id,quantity:1})});const a=await call(),b=await call();assert.equal(a.status,201);assert.equal(b.status,201);assert.equal(b.headers.get("idempotency-replayed"),"true");const count=await pool.query("SELECT COUNT(*)::int n FROM orders WHERE idempotency_key=$1",[key]);assert.equal(count.rows[0].n,1);});
    await t.test("users can only see their own orders",async()=>{const list=await fetch(`${base}/api/v1/orders`,{headers:{Authorization:`Bearer ${tokenB}`}});assert.equal(list.status,200);const json=await list.json();assert.equal(json.data.some(o=>o.idempotencyKey===`retry-${suffix}`),false);});
    await t.test("parallel requests never oversell",async()=>{const requests=Array.from({length:20},(_,i)=>fetch(`${base}/api/v1/orders`,{method:"POST",headers:{"content-type":"application/json","Authorization":`Bearer ${tokenA}`,"Idempotency-Key":`parallel-${suffix}-${i}`},body:JSON.stringify({productId:product.id,quantity:1})}));const responses=await Promise.all(requests);const success=responses.filter(r=>r.status===201).length;assert.equal(success,4);const state=await pool.query("SELECT stock FROM products WHERE id=$1",[product.id]);assert.equal(state.rows[0].stock,0);});
    await t.test("sold-out product returns 409",async()=>{const r=await fetch(`${base}/api/v1/orders`,{method:"POST",headers:{"content-type":"application/json","Authorization":`Bearer ${tokenB}`,"Idempotency-Key":`soldout-${suffix}`},body:JSON.stringify({productId:product.id,quantity:1})});assert.equal(r.status,409);assert.equal((await r.json()).error.code,"INSUFFICIENT_STOCK");});
    await t.test("other user cannot read another user's order",async()=>{const own=await pool.query("SELECT id FROM orders WHERE idempotency_key=$1",[ `retry-${suffix}`]);const r=await fetch(`${base}/api/v1/orders/${own.rows[0].id}`,{headers:{Authorization:`Bearer ${tokenB}`}});assert.equal(r.status,404);});
  } finally {
    if(product?.id) { await pool.query("DELETE FROM idempotency_keys WHERE key LIKE $1",[`${"unused"}%`]).catch(()=>{}); await pool.query("DELETE FROM idempotency_keys WHERE user_id IN(SELECT id FROM users WHERE email LIKE $1 OR email LIKE $2)",[`a-%@example.test`,`b-%@example.test`]).catch(()=>{}); await pool.query("DELETE FROM orders WHERE product_id=$1",[product.id]).catch(()=>{}); await pool.query("DELETE FROM products WHERE id=$1",[product.id]).catch(()=>{}); }
    if(userA?.user?.id) { await pool.query("DELETE FROM idempotency_keys WHERE user_id=$1",[userA.user.id]).catch(()=>{}); await pool.query("DELETE FROM users WHERE id=$1",[userA.user.id]).catch(()=>{}); }
    if(userB?.user?.id) { await pool.query("DELETE FROM idempotency_keys WHERE user_id=$1",[userB.user.id]).catch(()=>{}); await pool.query("DELETE FROM users WHERE id=$1",[userB.user.id]).catch(()=>{}); }
    if(server){server.kill("SIGTERM");}
    if(pool)await pool.end();
  }
});
