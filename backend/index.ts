import express from "express";
import { createClient } from "redis";
import cors from "cors";
import {Pool} from "pg";

import { PrismaPg } from "@prisma/adapter-pg";;
import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";

import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import cookieParser from "cookie-parser";
import {authMiddleWare} from "./middleware/authmiddleware.ts";

import {HttpStatusCode} from "./types.ts"
import { availableMemory } from "node:process";

dotenv.config();

const app = express();
const client = await createClient({url : "rediss://default:gQAAAAAAAhOSAAIgcDEyZTIyZDMxOTRiMmE0ODliYjg0N2VjODUyYzY4MjczOA@robust-meerkat-136082.upstash.io:6379"}).connect

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
app.post("/order",authMiddleWare, async (req: any, res: any) => {
    try {

        const userId = req.userId;
        const {side, type, symbol, price, qty} = req.body;



        // Validation

        const stock = await prisma.stock.findUnique({where: {symbol}})
        if(!stock) return res.status(HttpStatusCode.INTERNAL_SERVER_ERROR).json({error: "unknown stock symbol"});
        if(!ORDERBOOK[symbol]) return res.status(HttpStatusCode.NOT_FOUND).json({error: "no orderbook for the symbol"});
        if(qty <= 0) return res.status(HttpStatusCode.BAD_REQUEST).json({error: "qty must be positive"});
        if(type === 'LIMIT' && (!price || price <= 0)) return res.status(HttpStatusCode.BAD_REQUEST).json({error: "limit order need a valid price"});


        // checl + load balance

        ensureBalance(userId, "USD");
        ensureBalance(userId, symbol);


        let lockedAmount = 0;

        if(side === "BUY"){
            if(type === "LIMIT"){
                lockedAmount = price * qty;
            } else {
                lockedAmount = BALANCES[userId]!["INR"]!.available
            }
        

        if(BALANCES[userId]!["INR"]!.available < lockedAmount || lockedAmount<=0){
            return res.status(HttpStatusCode.BAD_REQUEST).json({error: "Insufficient INR balance"})
        }

        BALANCES[userId]!["INR"]!.available -= lockedAmount;
        BALANCES[userId]!["INR"]!.locked += lockedAmount;
    } else {
        lockedAmount = qty;

        if(BALANCES[userId]![symbol]! < qty){
            return res.status(HttpStatusCode.BAD_REQUEST).json({error: "Insufficient stock balance"})
        }

        BALANCES[userId]![symbol]!.available -= lockedAmount;
        BALANCES[userId]![symbol]!.locked += lockedAmount;

    }


    // ORDER CREATE 

    const order = await prisma.order.create({
      data: {
        userId,
        stockId: stock.id,
        market: symbol,
        price: price || 0,
        qty,
        type,
        side,
        filledQty: 0,
      },
    });


    // RUNNING MATCHING ENGINE;

    let remianingQty = qty;
    let totalTradedValue = 0;

    const oppositeSide = side === "BUY" ? ORDERBOOK[symbol]!.ask : ORDERBOOK[symbol]!.bids;

    const priceLevel =  Object.keys(oppositeSide).map(Number)
    .sort((a, b) => (side === "BUY" ? a - b : b - a ));

    for(let i = 0; i < priceLevel.length; i++){
        const levelPrice = priceLevel[i];

        if(remianingQty < qty) break;

        if(side === "LIMIT"){
            if(side === "BUY" && levelPrice! > price) break;

            if(side === "SELL" && levelPrice! < price) break;
        }



        const queue = oppositeSide[levelPrice!]

        while (queue?.length! > 0 && remianingQty > 0){

            const restingOrder = queue![0];

            const fillQty = Math.min(remianingQty, restingOrder!.qty);



            const buyUserId = side === "BUY"? userId : restingOrder!.userId;
            const sellUserId = side === "BUY"? restingOrder!.userId : userId;

            const buyOrderId = side === "BUY"? order.id : restingOrder!.orderId;
            const sellOrderId = side === "BUY"? restingOrder!.orderId: order.id;

            await prisma.fill.create({
            data: {
            userId: buyUserId,
            qty: fillQty,
            side: "BUY",
            type,
            price: levelPrice!,
            asset: symbol,
            originalOrderId: buyOrderId,
            },
        });
    
            await prisma.fill.create({
            data: {
            userId: sellUserId,
            qty: fillQty,
            side: "SELL",
            type,
            price: levelPrice!,
            asset: symbol,
            originalOrderId: sellOrderId,
            },
        });


        const tradeValue = fillQty * levelPrice!;

        BALANCES[buyUserId]!["INR"]!.locked -= tradeValue;
        BALANCES[buyUserId]![symbol]!.available += fillQty;

        BALANCES[sellUserId]!["INR"]!.available += tradeValue;
        BALANCES[sellUserId]![symbol]!.locked -= fillQty;



        await prisma.order.update({
            where: {id: buyOrderId},
            data: {filledQty : {increment: fillQty}}
        });


        await prisma.order.update({
            where: {id: sellOrderId},
            data: {filledQty : {increment: fillQty}}
        });



        totalTradedValue += tradeValue;

        remianingQty -= fillQty;

        restingOrder!.qty -= fillQty;

        if(restingOrder!.qty === 0){
            queue?.shift();
        }
    }

            if(queue?.length === 0){
                delete oppositeSide[levelPrice!];
        }
    }


    // now market order BUY 

    if(type === "MARKET" && side === "BUY"){
        const unusedAmount = lockedAmount - totalTradedValue
        if(unusedAmount > 0){
            BALANCES[userId]!["INR"]!.locked -= unusedAmount;
            BALANCES[userId]!["INR"]!.available += unusedAmount;
        }
    }

    if (remianingQty > 0){
        if(type === "LIMIT"){
            const mySide = side === "BUY" ? ORDERBOOK[symbol].bids : ORDERBOOK[symbol].ask;
            if(!mySide[price]) mySide[price] = [];
            mySide[price].push({orderId: order.id, userId , price, qty: remianingQty })
        } else {
            if (side === "SELL"){
                BALANCES[userId]![symbol]!.locked -= remianingQty;
                BALANCES[userId]![symbol]!.available += remianingQty;
            }
        }
    }

    res.json({orderId : order.id, filledQty: qty - remianingQty, remianingQty})


    } catch (error) {
        console.log(error);
        res.status(HttpStatusCode.INTERNAL_SERVER_ERROR).josn({error: "order placement failed"})
    }
});
/*
    returns the status of an order (partially filled, success, cancellled)
    ALSO RETURNS THE INDIVIDUAL FILLS OF THIS ORDER 
*/

// queue using gonna happen
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

app.listen(3000, () => console.log("CEX running on :3000"));