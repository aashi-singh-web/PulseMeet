import express from "express";
import { createServer } from "node:http";

import { Server } from "socket.io";

import mongoose from "mongoose";
import { connectToSocket } from "./controllers/socketManager.js";

import cors from "cors";
import userRoutes from "./routes/users.routes.js";

const app = express();
const server = createServer(app);
const io = connectToSocket(server);


app.set("port", (process.env.PORT || 8000))
app.use(cors());
app.use(express.json({ limit: "40kb" }));
app.use(express.urlencoded({ limit: "40kb", extended: true }));

app.use("/api/v1/users", userRoutes);

const start = async () => {
    app.set("mongo_user")
    const connectionDb = await mongoose.connect("mongodb://aashiishere2004_db_user1:lIF3300tF8F9MZRK@ac-8ja3gz4-shard-00-00.vj7xbnn.mongodb.net:27017,ac-8ja3gz4-shard-00-01.vj7xbnn.mongodb.net:27017,ac-8ja3gz4-shard-00-02.vj7xbnn.mongodb.net:27017/?ssl=true&replicaSet=atlas-2725zz-shard-0&authSource=admin&appName=PBL")

    console.log(`MONGO Connected DB HOst: ${connectionDb.connection.host}`)
    server.listen(app.get("port"), () => {
        console.log("LISTENING ON PORT 8000")
    });



}



start();