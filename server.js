require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const mongoose = require('mongoose');
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// 1. Cloudinary Configuration
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// Multer Storage for Cloudinary with Auto-Compression & Optimization
const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'barberq_shops',
    allowed_formats: ['jpg', 'png', 'jpeg', 'webp'],
    transformation: [{ width: 1000, height: 1000, crop: 'limit', quality: 'auto', fetch_format: 'auto' }]
  }
});
const upload = multer({ storage: storage });

// 2. MongoDB Database Connection
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB Database Connected Successfully!"))
  .catch(err => console.log("❌ MongoDB Connection Error:", err));

// 3. Database Schema
const shopSchema = new mongoose.Schema({
    name: String,
    ownerName: String,
    phone: String,
    lat: Number,
    lng: Number,
    address: String,
    services: Array,
    rating: { type: Number, default: 5.0 },
    reviewsCount: { type: Number, default: 1 },
    images: Array,
    queue: { type: Array, default: [] }
});
const Shop = mongoose.model('Shop', shopSchema);

// API: Fetch Nearby Shops from MongoDB
app.get('/api/shops/nearby', async (req, res) => {
  const userLat = parseFloat(req.query.lat);
  const userLng = parseFloat(req.query.lng);

  const calculateDistance = (lat1, lon1, lat2, lon2) => {
    const R = 6371; 
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
              Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c; 
  };

  try {
      const allShops = await Shop.find({});
      const nearby = allShops.map(shop => {
        const dist = calculateDistance(userLat, userLng, shop.lat, shop.lng);
        return { ...shop._doc, distanceKm: dist.toFixed(2), id: shop._id };
      })
      .filter(shop => shop.distanceKm <= 50)
      .sort((a, b) => a.distanceKm - b.distanceKm); 

      res.json(nearby);
  } catch(err) {
      res.status(500).json({ error: "Database error" });
  }
});

// API: Register New Salon & Upload to Cloudinary
app.post('/api/shops/register', upload.array('photos', 5), async (req, res) => {
  const { name, ownerName, phone, lat, lng, address, services } = req.body;
  const imagePaths = req.files ? req.files.map(f => f.path) : [];

  try {
      const newShop = new Shop({
        name,
        ownerName,
        phone,
        lat: parseFloat(lat),
        lng: parseFloat(lng),
        address,
        services: JSON.parse(services || '[]'),
        images: imagePaths.length ? imagePaths : ["https://images.unsplash.com/photo-1503951914875-452162b0f3f1?w=500"]
      });
      await newShop.save();
      res.status(201).json({ success: true, shop: { ...newShop._doc, id: newShop._id } });
  } catch(err) {
      res.status(500).json({ error: "Failed to save shop" });
  }
});

// API: Delete Salon & Auto-Delete Photos from Cloudinary
app.delete('/api/shops/:id', async (req, res) => {
  try {
      const shop = await Shop.findById(req.params.id);
      if (!shop) return res.status(404).json({ error: "Shop not found" });

      // Cloudinary se photos delete karna
      for (let imgUrl of shop.images) {
          if (imgUrl.includes('cloudinary.com')) {
              const publicId = imgUrl.split('/').pop().split('.')[0];
              await cloudinary.uploader.destroy(`barberq_shops/${publicId}`);
          }
      }

      await Shop.findByIdAndDelete(req.params.id);
      res.json({ success: true, message: "Shop and cloud images deleted successfully!" });
  } catch(err) {
      res.status(500).json({ error: "Failed to delete shop" });
  }
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

io.on('connection', (socket) => {
  socket.on('join_shop', (shopId) => {
    socket.join(shopId);
  });

  socket.on('book_appointment', async ({ shopId, customerName, customerPhone, serviceName, duration }) => {
    try {
        const shop = await Shop.findById(shopId);
        if (shop) {
          const tokenNumber = "TKN-" + Math.floor(1000 + Math.random() * 9000); 
          const totalWaitMinutes = shop.queue.reduce((acc, curr) => acc + curr.duration, 0);
          const appointmentTime = new Date(Date.now() + (totalWaitMinutes * 60000));
          const timeString = appointmentTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

          const newBooking = {
            tokenNumber,
            customerName,
            customerPhone,
            serviceName,
            duration: parseInt(duration),
            appointmentTime: timeString
          };

          shop.queue.push(newBooking);
          await shop.save();

          io.to(shopId).emit('queue_updated', { queue: shop.queue, shopId, newBooking });
          socket.emit('booking_confirmed', newBooking);
        }
    } catch(err) {
        console.log(err);
    }
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server running live on port ${PORT}`);
});