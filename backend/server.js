const express = require('express');
const cors = require('cors');
const { MongoClient } = require('mongodb');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// MongoDB connection - using environment variable
const uri = process.env.MONGODB_URI;
const client = new MongoClient(uri);

// Connect to MongoDB
async function connectToMongo() {
    try {
        await client.connect();
        console.log('Connected to MongoDB');
    } catch (error) {
        console.error('Error connecting to MongoDB:', error);
        process.exit(1);
    }
}

// API endpoint to store events
app.post('/api/events', async (req, res) => {
    try {
        const { taskId, events } = req.body;
        
        if (!taskId || !events) {
            return res.status(400).json({ error: 'taskId and events are required' });
        }

        const database = client.db("webcapstone");
        const collection = database.collection("events");

        const documentToInsert = {
            taskId,
            timestamp: new Date(),
            events
        };

        const result = await collection.insertOne(documentToInsert);
        
        res.status(201).json({
            success: true,
            message: 'Events stored successfully',
            documentId: result.insertedId
        });
    } catch (error) {
        console.error('Error storing events:', error);
        res.status(500).json({ error: 'Failed to store events' });
    }
});

// Start server
connectToMongo().then(() => {
    app.listen(port, () => {
        console.log(`Server is running on port ${port}`);
    });
}); 