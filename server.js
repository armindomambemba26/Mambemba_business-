import express from "express";
import cors from "cors";
import multer from "multer";
import dotenv from "dotenv";
import { pool, initDb } from "./db.js";
import { auth, allow, signToken, hashPassword, comparePassword } from "./auth.js";
import { uploadBuffer } from "./storage.js";
import { makeReceipt } from "./receipts.js";
import { messaging } from "./firebase.js";

dotenv.config();
const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

app.use(cors({ origin: true }));
app.use(express.json({ limit: "1mb" }));

app.get("/health", (_,res)=>res.json({ok:true, version:"3.1.0"}));

app.post("/api/auth/login", async (req,res)=>{
  const { username, password } = req.body;
  const { rows } = await pool.query("SELECT * FROM users WHERE username=$1 AND active=true", [username]);
  const u = rows[0];
  if (!u || !(await comparePassword(password, u.password_hash))) return res.status(401).json({error:"Utilizador ou palavra-passe inválidos"});
  res.json({ token: signToken(u), user: {id:u.id,name:u.name,username:u.username,role:u.role} });
});

app.get("/api/me", auth, (req,res)=>res.json(req.user));

app.get("/api/orders", auth, async (req,res)=>{
  const { rows } = await pool.query("SELECT * FROM orders ORDER BY delivery_date DESC, delivery_time DESC");
  res.json(rows.map(r=>({
    id:r.id,name:r.name,gender:r.gender,phone:r.phone,whatsapp:r.whatsapp,location:r.location,
    deliveryLocation:r.delivery_location,deliveryDate:r.delivery_date,deliveryTime:String(r.delivery_time).slice(0,5),
    category:r.category,product:r.product,cost:Number(r.cost),taxi:Number(r.taxi),color:r.color,size:r.size,
    photo:r.photo_url,notes:r.notes,news:r.news,status:r.status,publicToken:r.public_token,receiptUrl:r.receipt_url
  })));
});

app.post("/api/orders", auth, allow("admin","gestor","vendedor"), upload.single("photo"), async (req,res)=>{
  const b = req.body;
  let photoUrl = null;
  if (req.file) photoUrl = await uploadBuffer(req.file.buffer, req.file.mimetype, "products");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const c = await client.query(
      `INSERT INTO clients(name,gender,phone,whatsapp,location,news) VALUES($1,$2,$3,$4,$5,$6)
       ON CONFLICT DO NOTHING RETURNING id`,
      [b.name,b.gender,b.phone,b.whatsapp,b.location,b.news==="true"]
    );
    const clientId = c.rows[0]?.id || null;
    const q = await client.query(
      `INSERT INTO orders(client_id,name,gender,phone,whatsapp,location,delivery_location,delivery_date,delivery_time,category,product,cost,taxi,color,size,photo_url,notes,news,created_by)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING *`,
      [clientId,b.name,b.gender,b.phone,b.whatsapp,b.location,b.deliveryLocation,b.deliveryDate,b.deliveryTime,b.category,b.product,b.cost,b.taxi,b.color,b.size,photoUrl,b.notes,b.news==="true",req.user.sub]
    );
    await client.query("INSERT INTO audit_logs(user_id,action,entity,entity_id) VALUES($1,'create','order',$2)",[req.user.sub,q.rows[0].id]);
    await client.query("COMMIT");
    res.status(201).json(q.rows[0]);
  } catch(e){ await client.query("ROLLBACK"); res.status(400).json({error:e.message}); } finally { client.release(); }
});

app.put("/api/orders/:id", auth, allow("admin","gestor","vendedor"), upload.single("photo"), async (req,res)=>{
  const b=req.body;
  let photo = b.photo || null;
  if (req.file) photo = await uploadBuffer(req.file.buffer, req.file.mimetype, "products");
  const q=await pool.query(
    `UPDATE orders SET name=$1,gender=$2,phone=$3,whatsapp=$4,location=$5,delivery_location=$6,delivery_date=$7,delivery_time=$8,
     category=$9,product=$10,cost=$11,taxi=$12,color=$13,size=$14,photo_url=COALESCE($15,photo_url),notes=$16,news=$17,updated_at=NOW()
     WHERE id=$18 RETURNING *`,
    [b.name,b.gender,b.phone,b.whatsapp,b.location,b.deliveryLocation,b.deliveryDate,b.deliveryTime,b.category,b.product,b.cost,b.taxi,b.color,b.size,photo,b.notes,b.news==="true",req.params.id]
  );
  res.json(q.rows[0]);
});

app.patch("/api/orders/:id/status", auth, allow("admin","gestor","entregador"), async (req,res)=>{
  const q=await pool.query("UPDATE orders SET status=$1,updated_at=NOW() WHERE id=$2 RETURNING *",[req.body.status,req.params.id]);
  if(!q.rows[0]) return res.status(404).json({error:"Encomenda não encontrada"});
  res.json(q.rows[0]);
});

app.get("/api/orders/:id/receipt", auth, async (req,res)=>{
  const q=await pool.query("SELECT * FROM orders WHERE id=$1",[req.params.id]);
  if(!q.rows[0]) return res.status(404).json({error:"Não encontrada"});
  const url = await makeReceipt(q.rows[0]);
  await pool.query("UPDATE orders SET receipt_url=$1 WHERE id=$2",[url,req.params.id]);
  res.json({url});
});

app.get("/api/orders/:id/share", auth, async (req,res)=>{
  const q=await pool.query("SELECT * FROM orders WHERE id=$1",[req.params.id]);
  if(!q.rows[0]) return res.status(404).json({error:"Não encontrada"});
  const o=q.rows[0];
  const receipt=o.receipt_url || await makeReceipt(o);
  if(!o.receipt_url) await pool.query("UPDATE orders SET receipt_url=$1 WHERE id=$2",[receipt,o.id]);
  const phone=(o.whatsapp||o.phone||"").replace(/\D/g,"");
  const wa=phone ? `https://wa.me/${phone}?text=${encodeURIComponent("Olá! Segue o recibo da sua encomenda Mambemba Business: "+receipt)}` : "";
  const sms=phone ? `sms:${phone}?body=${encodeURIComponent("Recibo Mambemba Business: "+receipt)}` : "";
  const email=`mailto:?subject=${encodeURIComponent("Recibo Mambemba Business")}&body=${encodeURIComponent("Segue o recibo: "+receipt)}`;
  res.json({url:receipt,whatsapp:wa,email,sms});
});

app.get("/api/verify/:token", async (req,res)=>{
  const q=await pool.query("SELECT id,name,product,cost,taxi,status,delivery_date,delivery_time,public_token FROM orders WHERE public_token=$1",[req.params.token]);
  if(!q.rows[0]) return res.status(404).send("<h1>Recibo inválido</h1><p>Este recibo não foi encontrado.</p>");
  const o=q.rows[0];
  res.type("html").send(`<!doctype html><html lang="pt"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Validação — Mambemba Business</title><style>body{font-family:Arial;background:#f4f5f7;padding:30px}.c{max-width:560px;margin:auto;background:white;padding:25px;border-radius:18px}h1{color:#b40018}.ok{color:#16823b;font-weight:800}</style>
  <div class=c><h1>MAMBEMBA BUSINESS</h1><p class=ok>✓ Recibo válido</p><p><b>Cliente:</b> ${o.name}</p><p><b>Produto:</b> ${o.product}</p><p><b>Data:</b> ${o.delivery_date}</p><p><b>Total:</b> ${(Number(o.cost)+Number(o.taxi)).toLocaleString("pt-AO")} Kz</p><p><b>Estado:</b> ${o.status==="done"?"Entregue":"Pendente"}</p><small>ID: ${o.id}</small></div></html>`);
});

app.get("/api/clients", auth, allow("admin","gestor","vendedor"), async (_,res)=>{
  const {rows}=await pool.query(`SELECT c.*,COUNT(o.id)::int orders FROM clients c LEFT JOIN orders o ON o.client_id=c.id GROUP BY c.id ORDER BY c.created_at DESC`);
  res.json(rows);
});

app.get("/api/team", auth, allow("admin","gestor"), async (_,res)=>{
  const {rows}=await pool.query("SELECT id,name,username,role,active FROM users ORDER BY created_at DESC"); res.json(rows);
});
app.post("/api/team", auth, allow("admin"), async (req,res)=>{
  const {name,username,password,role}=req.body;
  const h=await hashPassword(password || "Mudar123!");
  const q=await pool.query("INSERT INTO users(name,username,password_hash,role) VALUES($1,$2,$3,$4) RETURNING id,name,username,role,active",[name,username,h,role||"vendedor"]);
  res.status(201).json(q.rows[0]);
});

app.get("/api/finance", auth, allow("admin","gestor","financeiro"), async (_,res)=>{
  const q=await pool.query("SELECT COALESCE(SUM(cost),0) products,COALESCE(SUM(taxi),0) taxi,COALESCE(SUM(cost+taxi),0) total FROM orders");
  res.json(q.rows[0]);
});

app.post("/api/push/token", auth, async(req,res)=>{
  await pool.query("INSERT INTO push_tokens(user_id,token) VALUES($1,$2) ON CONFLICT(token) DO UPDATE SET user_id=EXCLUDED.user_id",[req.user.sub,req.body.token]);
  res.json({ok:true});
});

app.post("/api/push/test", auth, allow("admin","gestor"), async(req,res)=>{
  const q=await pool.query("SELECT token FROM push_tokens");
  if(q.rows.length) await messaging.sendEachForMulticast({tokens:q.rows.map(x=>x.token),notification:{title:"Mambemba Business",body:req.body.body||"Nova notificação"}});
  res.json({sent:q.rows.length});
});

app.get("/api/health/db", auth, allow("admin"), async(_,res)=>{await pool.query("SELECT 1");res.json({ok:true})});

const port=process.env.PORT||8080;
initDb().then(async()=>{
  const exists=await pool.query("SELECT COUNT(*)::int count FROM users");
  if(exists.rows[0].count===0){
    const h=await hashPassword("03052000");
    await pool.query("INSERT INTO users(name,username,password_hash,role) VALUES($1,$2,$3,'admin')",["Administrador","Admin",h]);
  }
  app.listen(port,"0.0.0.0",()=>console.log(`API ${port}`));
}).catch(e=>{console.error(e);process.exit(1)});
