import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { Pool } from "pg";
import dotenv from "dotenv";

dotenv.config();

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
    const stocks = await prisma.stock.createMany({
        data: [
            { name: "Solana", symbol: "SOL" },
            { name: "Bitcoin", symbol: "BTC" },
            { name: "Hyperliquid", symbol: "HYPE" }
        ],
        skipDuplicates: true // agar dobara chalaye toh duplicate error nahi dega
    });

    console.log(`✅ ${stocks.count} stocks seeded successfully`);
}

main()
    .catch((e) => console.error("Seeding error:", e))
    .finally(async () => {
        await prisma.$disconnect();
    });
