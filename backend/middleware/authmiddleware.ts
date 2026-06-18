import jwt from "jsonwebtoken";
const JWT_SECRET = process.env.JWT_SECRET || "shhhh123";



export function authMiddleWare(req: any, res: any, next: any){
    const token = res.cookies.token;

    if(!token){
        return res.status(401).json({ error: "no token, please login" })
    }

    try {
        const decoded: any = jwt.verify(token, JWT_SECRET);
        req.userId = decoded.userId;
    } catch (error) {
        res.status(401).json({error: "Invalid Token"})
    }
}