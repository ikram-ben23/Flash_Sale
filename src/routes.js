const express = require("express");
const { pool } = require("./db");
const { HttpError } = require("./errors");
const { authenticate } = require("./middleware");
const { z } = require("zod");
const { createHash } = require("node:crypto");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const rateLimit = require("express-rate-limit");
const { jwtSecret, jwtExpiresIn, authRateMax, rateWindowMs } = require("./config");
const router = express.Router();
const authLimiter = rateLimit({ windowMs:rateWindowMs, limit:authRateMax, standardHeaders:"draft-7", legacyHeaders:false,
  message:{ success:false, error:{code:"AUTH_RATE_LIMITED",message:"Too many authentication attempts. Try later."} } });
function validate(schema, value) {
  const r = schema.safeParse(value);
  if (!r.success) throw new HttpError(400, "VALIDATION_ERROR", "Request validation failed.",
    r.error.issues.map(x => ({ path:x.path.join("."), message:x.message })));
  return r.data;
}
const uuid = z.string().uuid();
const registerSchema = z.object({ name:z.string().trim().min(2).max(80), email:z.string().trim().email().max(254).transform(s=>s.toLowerCase()), password:z.string().min(10).max(72) }).strict();
const loginSchema = z.object({ email:z.string().trim().email().max(254).transform(s=>s.toLowerCase()), password:z.string().min(1).max(72) }).strict();
function tokenFor(user) { return jwt.sign({ email:user.email }, jwtSecret, { subject:user.id, expiresIn:jwtExpiresIn, issuer:"flash-sale-api", audience:"flash-sale-clients" }); }
router.get("/health", async(req,res,next)=>{try{await pool.query("SELECT 1");res.json({success:true,data:{status:"ok",database:"connected"}});}catch(e){next(e);}});
router.post("/auth/register",authLimiter,async(req,res,next)=>{
 try {
  const body=validate(registerSchema,req.body);
  const passwordHash=await bcrypt.hash(body.password,12);
  const r=await pool.query("INSERT INTO users(name,email,password_hash) VALUES($1,$2,$3) ON CONFLICT(email) DO NOTHING RETURNING id,name,email,created_at AS \"createdAt\"",[body.name,body.email,passwordHash]);
  if(!r.rowCount) throw new HttpError(409,"EMAIL_ALREADY_REGISTERED","An account with this email already exists.");
  const user=r.rows[0];res.status(201).json({success:true,data:{user,token:tokenFor(user),tokenType:"Bearer",expiresIn:jwtExpiresIn}});
 } catch(e){next(e);}
});
router.post("/auth/login",authLimiter,async(req,res,next)=>{
 try {
  const body=validate(loginSchema,req.body);
  const r=await pool.query("SELECT id,name,email,password_hash FROM users WHERE email=$1",[body.email]);
  if(!r.rowCount || !(await bcrypt.compare(body.password,r.rows[0].password_hash))) throw new HttpError(401,"INVALID_CREDENTIALS","Email or password is incorrect.");
  const u=r.rows[0];res.json({success:true,data:{user:{id:u.id,name:u.name,email:u.email},token:tokenFor(u),tokenType:"Bearer",expiresIn:jwtExpiresIn}});
 } catch(e){next(e);}
});
router.get("/auth/me",authenticate,async(req,res,next)=>{try{const r=await pool.query("SELECT id,name,email,created_at AS \"createdAt\" FROM users WHERE id=$1",[req.user.id]);if(!r.rowCount)throw new HttpError(401,"INVALID_TOKEN","User no longer exists.");res.json({success:true,data:r.rows[0]});}catch(e){next(e);}});
router.get("/products",async(req,res,next)=>{try{
 const q=validate(z.object({search:z.string().trim().max(100).optional(),limit:z.coerce.number().int().min(1).max(100).default(20),offset:z.coerce.number().int().min(0).max(100000).default(0)}),req.query);
 const params=[];let where="";if(q.search){params.push(`%${q.search}%`);where="WHERE name ILIKE $1 OR description ILIKE $1";}
 params.push(q.limit,q.offset);
 const data=await pool.query(`SELECT id,name,description,price_cents AS "priceCents",currency,stock,(stock>0) AS "inStock",created_at AS "createdAt" FROM products ${where} ORDER BY created_at DESC,id ASC LIMIT $${params.length-1} OFFSET $${params.length}`,params);
 const count=await pool.query(`SELECT COUNT(*)::int AS total FROM products ${where}`,q.search?[`%${q.search}%`]:[]);
 res.json({success:true,data:data.rows,pagination:{limit:q.limit,offset:q.offset,total:count.rows[0].total}});
 }catch(e){next(e);}});
router.get("/products/:id",async(req,res,next)=>{try{
 const id=validate(uuid,req.params.id);
 const r=await pool.query('SELECT id,name,description,price_cents AS "priceCents",currency,stock,(stock>0) AS "inStock",created_at AS "createdAt" FROM products WHERE id=$1',[id]);
 if(!r.rowCount)throw new HttpError(404,"PRODUCT_NOT_FOUND","Product not found.");
 res.json({success:true,data:r.rows[0]});
 }catch(e){next(e);}});
router.post("/orders",authenticate,async(req,res,next)=>{
 const key=req.get("Idempotency-Key");
 if(!key||key.length<8||key.length>128||!/^[\w\-:.]+$/.test(key))return next(new HttpError(400,"IDEMPOTENCY_KEY_REQUIRED","Send an Idempotency-Key header (8-128 allowed characters)."));
 let body;try{body=validate(z.object({productId:uuid,quantity:z.number().int().min(1).max(100).default(1)}).strict(),req.body);}catch(e){return next(e);}
 const hash=createHash("sha256").update(JSON.stringify({userId:req.user.id,productId:body.productId,quantity:body.quantity})).digest("hex");
 const client=await pool.connect();
 try{
  await client.query("BEGIN");
  const claim=await client.query("INSERT INTO idempotency_keys(key,user_id,request_hash,state) VALUES($1,$2,$3,'processing') ON CONFLICT(key) DO NOTHING RETURNING key",[key,req.user.id,hash]);
  if(!claim.rowCount){
   const prior=await client.query("SELECT user_id,request_hash,response_status,response_body FROM idempotency_keys WHERE key=$1 FOR UPDATE",[key]);
   if(!prior.rowCount){await client.query("ROLLBACK");throw new HttpError(409,"IDEMPOTENCY_IN_PROGRESS","Retry shortly using the same key.");}
   if(prior.rows[0].user_id!==req.user.id){await client.query("ROLLBACK");throw new HttpError(409,"IDEMPOTENCY_KEY_REUSED","This idempotency key belongs to another user.");}
   if(prior.rows[0].request_hash!==hash){await client.query("ROLLBACK");throw new HttpError(409,"IDEMPOTENCY_KEY_REUSED","This key was already used with a different request.");}
   if(prior.rows[0].response_body){const saved=prior.rows[0].response_body;await client.query("COMMIT");res.setHeader("Idempotency-Replayed","true");return res.status(prior.rows[0].response_status||200).json(saved);}
   await client.query("ROLLBACK");throw new HttpError(409,"IDEMPOTENCY_IN_PROGRESS","Retry shortly using the same key.");
  }
  const p=await client.query("SELECT id,name,price_cents,currency,stock FROM products WHERE id=$1 FOR UPDATE",[body.productId]);
  if(!p.rowCount){
   const response={success:false,error:{code:"PRODUCT_NOT_FOUND",message:"Product not found."}};
   await client.query("UPDATE idempotency_keys SET state='completed',response_status=404,response_body=$2::jsonb WHERE key=$1",[key,JSON.stringify(response)]);
   await client.query("COMMIT");return res.status(404).json(response);
  }
  const product=p.rows[0];
  if(product.stock<body.quantity){
   const response={success:false,error:{code:"INSUFFICIENT_STOCK",message:product.stock===0?"This product is sold out.":`Only ${product.stock} unit(s) remain in stock.`,availableStock:product.stock}};
   await client.query("UPDATE idempotency_keys SET state='completed',response_status=409,response_body=$2::jsonb WHERE key=$1",[key,JSON.stringify(response)]);
   await client.query("COMMIT");return res.status(409).json(response);
  }
  const o=await client.query(`INSERT INTO orders(user_id,product_id,quantity,unit_price_cents,currency,idempotency_key) VALUES($1,$2,$3,$4,$5,$6) RETURNING id,product_id AS "productId",quantity,unit_price_cents AS "unitPriceCents",currency,total_cents AS "totalCents",status,created_at AS "createdAt"`,[req.user.id,product.id,body.quantity,product.price_cents,product.currency,key]);
  await client.query("UPDATE products SET stock=stock-$2,updated_at=NOW() WHERE id=$1",[product.id,body.quantity]);
  const response={success:true,data:{...o.rows[0],productName:product.name,remainingStock:product.stock-body.quantity}};
  await client.query("UPDATE idempotency_keys SET state='completed',order_id=$2,response_status=201,response_body=$3::jsonb WHERE key=$1",[key,o.rows[0].id,JSON.stringify(response)]);
  await client.query("COMMIT");res.status(201).json(response);
 }catch(e){try{await client.query("ROLLBACK");}catch(_){}next(e);}finally{client.release();}
});
router.get("/orders",authenticate,async(req,res,next)=>{try{
 const q=validate(z.object({limit:z.coerce.number().int().min(1).max(100).default(20),offset:z.coerce.number().int().min(0).max(100000).default(0)}),req.query);
 const r=await pool.query(`SELECT o.id,o.product_id AS "productId",p.name AS "productName",o.quantity,o.unit_price_cents AS "unitPriceCents",o.currency,o.total_cents AS "totalCents",o.status,o.created_at AS "createdAt" FROM orders o JOIN products p ON p.id=o.product_id WHERE o.user_id=$1 ORDER BY o.created_at DESC LIMIT $2 OFFSET $3`,[req.user.id,q.limit,q.offset]);
 const count=await pool.query("SELECT COUNT(*)::int AS total FROM orders WHERE user_id=$1",[req.user.id]);
 res.json({success:true,data:r.rows,pagination:{limit:q.limit,offset:q.offset,total:count.rows[0].total}});
 }catch(e){next(e);}});
router.get("/orders/:id",authenticate,async(req,res,next)=>{try{
 const id=validate(uuid,req.params.id);
 const r=await pool.query(`SELECT o.id,o.product_id AS "productId",p.name AS "productName",o.quantity,o.unit_price_cents AS "unitPriceCents",o.currency,o.total_cents AS "totalCents",o.status,o.created_at AS "createdAt" FROM orders o JOIN products p ON p.id=o.product_id WHERE o.id=$1 AND o.user_id=$2`,[id,req.user.id]);
 if(!r.rowCount)throw new HttpError(404,"ORDER_NOT_FOUND","Order not found.");
 res.json({success:true,data:r.rows[0]});
 }catch(e){next(e);}});
module.exports=router;
