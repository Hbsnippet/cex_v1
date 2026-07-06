import express from "express";
import cors from "cors";
import {Pool} from "pg";
import { createClient } from "redis";

import { PrismaPg } from "@prisma/adapter-pg";;
import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";

import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import cookieParser from "cookie-parser";
import {authMiddleWare} from "./middleware/authmiddleware.ts";

import {HttpStatusCode} from "./types.ts"




dotenv.config();

const app = express();

app.use(express.json());
app.use(cors());
app.use(cookieParser())



const JWT_SECRET = process.env.JWT_SECRET  || "shhhh123";
const pool = new Pool({connectionString: process.env.DATABASE_URL })
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({adapter})






const client = await createClient({
    url: process.env.REDIS_URL, 
    socket: {
        reconnectStrategy: (retries) => {
            const delay = Math.min(retries * 100, 3000);
            console.log(`[Redis] Connection lost. Retrying in ${delay}ms...`);
            return delay;
        },
        connectTimeout: 10000,
    }
})
    .on("error", (err) => console.log("Redis Client Error", err.message))
    .connect();






type balance = {
    available: number;
    locked: number
}

type AssetBalance = {
    [asset: string]: balance;
}

type UserBalance = {
    [userId: number]: AssetBalance;
}


const BALANCES: UserBalance = {}

function ensureBalance(userId: number, asset: string){
    if(!BALANCES[userId]) BALANCES[userId] = {}
    if(!BALANCES[userId][asset]) BALANCES[userId][asset] = {available: 0, locked: 0}
}



// ----------------------------------------------------------------------------------------------------------------
//              AUTH
// ----------------------------------------------------------------------------------------------------------------






app.post("/signup", async (req, res) => {
    const {username, password} = req.body;

    if(!username || !password){
       return res.status(HttpStatusCode.NOT_FOUND).json({error: "username and password required"})
    };

    const existing = await prisma.user.findUnique({where: {username}})
    if(existing){
        return res.status(409).json({message: "username already taken"})
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    try {
  const user = await prisma.user.create({
    data: { username, password: hashedPassword }
  }); 

  ensureBalance(user.id, "INR");            
  BALANCES[user.id]!["INR"]!.available = 10000; 

  res.json({ message: "user created", userId: user.id }); 

} catch (error) {
  res.status(400).json({ message: "Username already exist" });
};
});




app.post("/signin",async (req, res) => {
    try {
    const {username, password} = req.body;

    if(!username || !password){
    return res.status(HttpStatusCode.NOT_FOUND).json({error: "username and password required"})
    };

    const user = await prisma.user.findUnique({where: {username}})
    if(!user) {
        return res.status(HttpStatusCode.UNAUTHORIZED).json({error: "invalid username or password"})
    }

    const verify = await bcrypt.compare(password, user.password);
    if(!verify){
        return res.status(HttpStatusCode.UNAUTHORIZED).json({error: "invalid username or password"})
    }

    const token = jwt.sign({userId: user.id}, JWT_SECRET, { expiresIn: "7d" });

    res.cookie("token", token, {
    httpOnly: true,  
    maxAge: 7 * 24 * 60 * 60 * 1000 
    });

    res.json({ message: "logged in", userId: user.id });
    } catch(e){
        console.log(e);
        res.status(HttpStatusCode.INTERNAL_SERVER_ERROR).json({error: "login failed"})
    }

})


app.post("/order", authMiddleWare, async (req: any, res: any) => {
    try {
        const userId = req.userId;
        const { side, type, symbol, price, qty } = req.body;

        // Basic structural validations (bina DB ko hit kiye)
        if (!symbol || !qty || qty <= 0) {
            return res.status(400).json({ error: "Invalid qty or symbol" });
        }
        if (type === 'LIMIT' && (!price || price <= 0)) {
            return res.status(400).json({ error: "Limit order needs a valid price" });
        }

        // ⚡ ASSET DEFINITION FOR THE QUEUE ENGINE
        const orderPayload = {
            userId,
            side,        // "BUY" | "SELL"
            type,        // "LIMIT" | "MARKET"
            symbol,      // "SOL" | "BTC" etc.
            price: price || 0,
            qty,
            timestamp: Date.now()
        };

        // 🚀 Redis list 'incoming-orders' mein order ko push kar do
        await client.lPush("incoming-orders", JSON.stringify(orderPayload));

        // User ko turant free karo! (Bina matching ka wait kiye)
        return res.json({ 
            status: "PENDING", 
            message: "Order queued successfully" 
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Failed to queue order" });
    }
});
/*
    returns the status of an order (partially filled, success, cancellled)
    ALSO RETURNS THE INDIVIDUAL FILLS OF THIS ORDER 
*/

// queue using gonna happen
app.get("/order/:orderId", authMiddleWare, async (req: any, res: any) => {
    res.json({ message: "TODO: implement order status lookup" });
});

app.delete("/order/:orderId", authMiddleWare, async (req: any, res: any) => {
    res.json({ message: "TODO: implement order cancellation" });
});

app.get("/depth/:symbol", async (req, res) => {
    res.json({ message: "TODO: implement orderbook depth" });
});

app.get("/orders", authMiddleWare, async (req: any, res: any) => {
    res.json({ message: "TODO: implement orders list" });
});

app.get("/fills", authMiddleWare, async (req: any, res: any) => {
    res.json({ message: "TODO: implement fills list" });
});

app.get("/balance/usd", authMiddleWare, async (req: any, res: any) => {
    res.json({ message: "TODO: implement INR/USD balance" });
});

app.get("/balance", authMiddleWare, async (req: any, res: any) => {
    res.json({ message: "TODO: implement full balance" });
});

app.listen(3000, () => console.log("CEX running on :3000"));