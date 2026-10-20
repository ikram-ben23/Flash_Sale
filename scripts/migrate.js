const fs=require("node:fs"),path=require("node:path"),{pool}=require("../src/db");
(async()=>{try{await pool.query(fs.readFileSync(path.join(__dirname,"..","db/migrations/001_initial.sql"),"utf8"));console.log("Migration completed.");}catch(e){console.error("Migration failed:",e.message);process.exitCode=1;}finally{await pool.end();}})();
