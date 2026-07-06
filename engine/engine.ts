import { Pool } from "pg";
import { createClient } from "redis";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";


dotenv.config();

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// Redis connection setup
const redisWorker = await createClient({
    url: process.env.REDIS_URL,
    socket: {
        reconnectStrategy: (retries) => {
            const delay = Math.min(retries * 100, 3000);
            console.log(`[Redis] Connection lost. Retrying in ${delay}ms...`);
            return delay;
        }
    }
})
    .on("error", (err) => console.log("Redis Client Error", err.message))
    .connect();


console.log("REDIS_URL is:", process.env.REDIS_URL);











// TYPES DEFINED

type OpenOrder = {
    orderId: number,
    userId: number,
    price: number,
    qty: number
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

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))


// 🔥 MAIN LOOP: JO ORDERS KO UTAYEGA AUR PROCESS KAREGA
async function startEngine() {
    while (true) {
        try {
           
            const result = await redisWorker.rPop("incoming-orders");
            
            if (!result) {
                await sleep(2000);
                continue;
            };

            // result.element mein tera JSON string milega
            const orderData = JSON.parse(result);

            const { userId, side, type, symbol, price, qty } = orderData;

            console.log(`Processing order for user ${userId} | ${side} ${qty} ${symbol}`);

            // 1. DATABASE VALIDATION (JO PEHLE EXPRESS MEIN THI)
            const stock = await prisma.stock.findUnique({ where: { symbol } });
            if (!stock || !ORDERBOOK[symbol]) {
                console.log("❌ Invalid Stock or Orderbook configuration missed.");
                continue; 
            }

            ensureBalance(userId, "INR");
            ensureBalance(userId, symbol);

            // 2. BALANCE LOCKING LOGIC
            let lockedAmount = 0;
            if (side === "BUY") {
                if (type === "LIMIT") { lockedAmount = price * qty; } 
                else { lockedAmount = BALANCES[userId]!["INR"]!.available; }

                if (BALANCES[userId]!["INR"]!.available < lockedAmount || lockedAmount <= 0) {
                    console.log(`❌ Insufficient INR balance for user ${userId}`);
                    continue;
                }
                BALANCES[userId]!["INR"]!.available -= lockedAmount;
                BALANCES[userId]!["INR"]!.locked += lockedAmount;
            } else {
                lockedAmount = qty;
                if (BALANCES[userId]![symbol]!.available < qty) {
                    console.log(`❌ Insufficient stock balance for user ${userId}`);
                    continue;
                }
                BALANCES[userId]![symbol]!.available -= lockedAmount;
                BALANCES[userId]![symbol]!.locked += lockedAmount;
            }

            // 3. DB MEIN ORDER BANANA
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

            // 4. 🔥 TERA APNA MATCHING ENGINE ENGINE LOOP (JO TUNE LIKHA HAI)
            let remianingQty = qty;
            let totalTradedValue = 0;
            const oppositeSide = side === "BUY" ? ORDERBOOK[symbol]!.ask : ORDERBOOK[symbol]!.bids;
            const priceLevel = Object.keys(oppositeSide).map(Number).sort((a, b) => (side === "BUY" ? a - b : b - a));

            for (let i = 0; i < priceLevel.length; i++) {
                const levelPrice = priceLevel[i];

                if(levelPrice === undefined || levelPrice === null) continue;
                if (remianingQty <= 0) break; // Fix logic typo here from your code (remianingQty < qty was wrong)

                if (type === "LIMIT") { // Fix typo here from your code (side === "LIMIT" was written)
                    if (side === "BUY" && !levelPrice > price) break;
                    if (side === "SELL" && !levelPrice < price) break;
                }

                const queue = oppositeSide[levelPrice];
                while (queue && queue.length > 0 && remianingQty > 0) {
                    const restingOrder = queue[0];
                    const fillQty = Math.min(remianingQty, restingOrder!.qty);

                    const buyUserId = side === "BUY" ? userId : restingOrder!.userId;
                    const sellUserId = side === "BUY" ? restingOrder!.userId : userId;
                    const buyOrderId = side === "BUY" ? order.id : restingOrder!.orderId;
                    const sellOrderId = side === "BUY" ? restingOrder!.orderId : order.id;

                    // Prisma fills writes
                    await prisma.fill.create({ data: { userId: buyUserId, qty: fillQty, side: "BUY", type, price: levelPrice, asset: symbol, originalOrderId: buyOrderId } });
                    await prisma.fill.create({ data: { userId: sellUserId, qty: fillQty, side: "SELL", type, price: levelPrice, asset: symbol, originalOrderId: sellOrderId } });

                    const tradeValue = fillQty * levelPrice;
                    ensureBalance(buyUserId, symbol);
                    ensureBalance(sellUserId, symbol);

                    BALANCES[buyUserId]!["INR"]!.locked -= tradeValue;
                    BALANCES[buyUserId]![symbol]!.available += fillQty;
                    BALANCES[sellUserId]!["INR"]!.available += tradeValue;
                    BALANCES[sellUserId]![symbol]!.locked -= fillQty;

                    await prisma.order.update({ where: { id: buyOrderId }, data: { filledQty: { increment: fillQty } } });
                    await prisma.order.update({ where: { id: sellOrderId }, data: { filledQty: { increment: fillQty } } });

                    totalTradedValue += tradeValue;
                    remianingQty -= fillQty;
                    restingOrder!.qty -= fillQty;

                    if (restingOrder!.qty === 0) queue.shift();
                }
                if (queue && queue.length === 0) delete oppositeSide[levelPrice];
            }

            // Market orders unused amount rollback
            if (type === "MARKET" && side === "BUY") {
                const unusedAmount = lockedAmount - totalTradedValue;
                if (unusedAmount > 0) {
                    BALANCES[userId]!["INR"]!.locked -= unusedAmount;
                    BALANCES[userId]!["INR"]!.available += unusedAmount;
                }
            }

            // Remaining to orderbook
            if (remianingQty > 0) {
                if (type === "LIMIT") {
                    const mySide = side === "BUY" ? ORDERBOOK[symbol].bids : ORDERBOOK[symbol].ask;
                    if (!mySide[price]) mySide[price] = [];
                    mySide[price].push({ orderId: order.id, userId, price, qty: remianingQty });
                } else if (side === "SELL") {
                    BALANCES[userId]![symbol]!.locked -= remianingQty;
                    BALANCES[userId]![symbol]!.available += remianingQty;
                }
            }

            console.log(`✅ Order ${order.id} processed! Remaining Qty: ${remianingQty}`);

        } catch (err) {
            console.error("Error in matching engine execution loop:", err);
            await sleep(2000)
        }
    }
}

startEngine();