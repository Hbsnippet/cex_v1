import express from "express";
import cors from "cors";
import {Pool} from "pg";

import { PrismaPg } from "@prisma/adapter-pg";;
import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";

import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";

dotenv.config();

const app = express();

app.use(express.json());
app.use(cors());



const WT_SECRET = process.env.JWT_SECRET;
const pool = new Pool({connectionString: process.env.DATABASE_URL })
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({adapter})




const BALANCES = {

}

const ORDERBOOKS = {
    SOL: {},
    BTC: {}
}

app.post("/signup", async (req, res) => {
    const {username, password} = req.body;

    const hashedPassword = await bcrypt.hash(password, 10);

})

app.post("/signin", (req, res) => {

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