import express from "express";
import cors from "cors";
import { Server } from "socket.io";
import http from "http";
import { MongoClient, ObjectId, ServerApiVersion } from "mongodb";
import dotenv from 'dotenv'

const app = express();
app.use(express.json())
app.use(cors())

const PORT = process.env.PORT || 5000
dotenv.config()

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.hffkh7c.mongodb.net/?appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

const server = http.createServer(app)
const io = new Server(server, {
    cors: {
        origin: ['http://localhost:5173', 'https://sheikhnahian-snchat.vercel.app/']
    }
})

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();
    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    const myDb = client.db('myDB')
    const users = myDb.collection('users')
    await users.createIndex({ email: 1 }, { unique: true });
    const messages = myDb.collection('messages')
    const conversations = myDb.collection('conversations')
    
    console.log("Pinged your deployment. You successfully connected to MongoDB!");

    app.get('/', async(req, res)=> {
      res.send('Hello World!')
    })

    app.get('/users', async(req, res) => {
      const result = await await users.find().sort({isActive: -1}).toArray()
      res.send(result)
    })
    app.get('/users/:id', async(req, res) => {
      const id = req.params
      const result = await users.findOne({_id: new ObjectId(id)})
      res.send(result)
    })
    app.post('/users', async(req, res) => {
      const user = req.body;
      const userExist = await users.findOne({email: user.email})
      // console.log(userExist);
      if(userExist){
        return res.send({message: 'User Already Exist'})
      }
      user.createdAd = new Date()
      const result = await users.insertOne(user)
      res.send(result)
    })
    
    app.get('/messages', async(req, res) => {
      const {sender, receiver} = req.query;
      let query = {};
      query = {
        $or: [
            {
              senderEmail: sender,
              receiverEmail: receiver
            },
            {
              senderEmail: receiver,
              receiverEmail: sender
            }
          ]
      }
      const result = await messages.find(query).sort({createdAt: -1}).limit(30).toArray()
      res.send(result)
    })
    app.post('/messages', async(req, res) => {
      const msgData = req.body
      const result = await messages.insertOne(msgData)
      res.send(result)
    })
    app.patch('/messages/seen', async(req, res) => {
      // console.log(req.body);
      const {senderEmail, receiverEmail} = req.query
      const result = await messages.updateMany(
        {
          senderEmail: senderEmail,
          receiverEmail: receiverEmail
        },
        {
          $set: {
            seen: true,
            seenAt: new Date()
          }
        }
      )

    })

    app.get('/conversations/:user', async(req, res) => {
      const user = req.params.user
      const query = {
        participants: user
      }
      const result = await conversations.find(query).toArray()
      res.send(result)
    })
    app.get('/conversation', async(req, res) => {
      const {user1, user2} = req.query
      const result = await conversations.findOne({
        participants: {
          $all: [user1, user2]
        }
      })
      res.send(result)
    })
    app.post('/conversations', async (req, res) => {
      const {message} = req.body;
      const {user1, user2} = req.query
      const conversationId = [user1, user2].sort().join('_');

      // console.log(message);
      
      const result = await conversations.updateOne(
        {
          conversationId: conversationId
        },
        {
          $set: {
            conversationId: conversationId,
            participants: [user1, user2],
            lastMessage: message,
            lastMessageSender: user1,
            lastMessageTime: new Date(),
            lastMessageSeen: false
          }
        },
        {
          upsert: true
        }
      );

      res.send(result);
    });
    app.patch('/conversations', async(req, res) => {
      const {user1, user2} = req.query
      const result = await conversations.updateOne(
        {
          participants: {
            $all: [user1, user2]
          }
        },
        {
          $set: {
            lastMessageSeen: true
          }
        }
      )
      res.send(result)
    })

    const members = {}
    io.on('connection', (socket) => {
      console.log('Connected:', socket.id);
      socket.on('join', async(email) => {
        members[socket.id] = email
        socket.join(email)
        socket.email = email
        io.emit('activeUsers', Object.values(members))

        await users.updateOne(
          {
            email: email
          },
          {
            $set: {
              isActive: true
            }
          },
          {
            $upsert: true
          }
        )
      })

      socket.on('getActiveUsers', () => {
        socket.emit('activeUsers', Object.values(members));
      });
      
      socket.on('sendMessage', (data) => {
        console.log(data.message, 'from', socket.email);
        if(data.receiver){
          return io.to(data.receiver).emit('receiveMessage', {
            senderEmail: socket.email,
            message: data.message,
          })
        }
        
      })

      socket.on('seenMessage', (data) => {
        if(data.receiver){
          return io.to(data.receiver).emit('seenMessage', {seen: true})
        }
      })

      socket.on('disconnect', async() => {
        delete members[socket.id]   

        await users.updateOne(
          {
            email: socket.email
          },
          {
            $set: {
              isActive: false,
              lastSeen: new Date()
            }
          },
          {
            $upsert: true
          }
        )

        console.log('Disconnected', socket.email);
    })
    })

  } finally {
    // Ensures that the client will close when you finish/error
  }
}
run().catch(console.dir);

server.listen(PORT, () => {
    console.log('Server Running!');
})