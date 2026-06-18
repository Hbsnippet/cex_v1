import express from "express";
import cors from "cors";
import {Pool} from "pg";

import { PrismaPg } from "@prisma/adapter-pg";;
import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";

import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import cookieParser from "cookie-parser";
import { authMiddleWare } from "./middleware/authmiddleware.ts";

import {HttpStatusCode} from "./types.ts"

dotenv.config();

const app = express();

app.use(express.json());
app.use(cors());



const JWT_SECRET = process.env.JWT_SECRET  || "shhhh123";
const pool = new Pool({connectionString: process.env.DATABASE_URL })
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({adapter})







type OpenOrder = {
    orderId: number;
    userId: number;
    price: number;
    qty: number;
}

type OrderBookSide = {
    [price: number]: OpenOrder[]
}

const ORDERBOOK: {
    [symbol: string]: {
        bids: OrderBookSide;
        ask: OrderBookSide;
    }
} = {
    SOL: {bids: {}, ask: {}},
    BTC: {bids: {}, ask: {}},
    HYPE: {bids: {}, ask: {}}
}




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

/*
    body = {
        type:           "market" | "limit",
        price:          number | null,
        qty:            number,
        market_id:      string,
        side:           "buy" | "sell"
    }

    @returns {
        orderId: string,
        filledQty: number,
        averagePrice
    }
*/

// 50.01

// 500001
app.post("/order", (req, res) => {

})
/*
    returns the status of an order (partially filled, success, cancellled)
    ALSO RETURNS THE INDIVIDUAL FILLS OF THIS ORDER 
*/
app.get("/order/:orderId")
app.delete("/order/:orderId")
app.get("/depth/:symbol");
app.get("/orders");
app.get("/fills");

app.get("/balance/usd");

/*  
    Returns the balance of all stocks
*/
app.get("/balance")

app.listen(3000);