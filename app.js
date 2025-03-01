import express from 'express';
import mongoose from 'mongoose';
import { createClient } from 'redis';

const app = express();
app.use(express.json());

const client = createClient();
client.on('error', (err) => console.log('Redis Client Error:', err));
await client.connect();

mongoose.connect('mongodb://localhost:27017/node_cache')
    .then(() => console.log('MongoDB Connected'))
    .catch((err) => console.error('MongoDB Connection Error:', err));

const productSchema = new mongoose.Schema({
    name: String,
    description: String,
    price: Number,
    category: String,
    specs: Object,
});

const Product = mongoose.model('Product', productSchema);

function generateCacheKey(req) {
    const baseUrl = req.path.replace(/^\/+|\/+$/g, '').replace(/\//g, ':');
    const params = req.query;
    const sortedParams = Object.keys(params)
        .sort()
        .map((key) => `${key}=${params[key]}`)
        .join('&');
    return sortedParams ? `${baseUrl}:${sortedParams}` : baseUrl;
}

app.get('/api/products', async (req, res) => {
    try {
        const key = generateCacheKey(req);
        console.log('Generated Cache Key:', key);

        const cachedProducts = await client.get(key);
        if (cachedProducts) {
            console.log('Cache Hit');
            return res.json(JSON.parse(cachedProducts));
        }
        console.log('Cache Miss');

        const query = req.query.category ? { category: req.query.category } : {};
        const products = await Product.find(query);
        console.log('Fetched from MongoDB:', products.length, 'products');

        if (products.length) {
            await client.set(key, JSON.stringify(products), { EX: 300 });
            console.log('Data Cached for 300s:', key);
        }

        res.json(products);
    } catch (error) {
        console.error('Error fetching products:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

app.put('/api/products/:id', async (req, res) => {
    try {
        const productId = req.params.id;
        const updateData = req.body;

        const updatedProduct = await Product.findByIdAndUpdate(
            productId,
            { $set: updateData },
            { new: true }
        );

        if (!updatedProduct) {
            return res.status(404).json({ success: false, message: 'Product not found' });
        }

        const listCacheKey = 'api:products*';
        const keys = await client.keys(listCacheKey);
        if (keys.length > 0) {
            await client.del(keys);
            console.log('Cache cleared after update');
        }

        res.json({ success: true, message: 'Product updated successfully' });
    } catch (error) {
        console.error('Error updating product:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

app.listen(4000, () => console.log('Server listening on port 4000'));
