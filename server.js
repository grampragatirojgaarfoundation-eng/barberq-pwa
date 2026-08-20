require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const multer = require('multer');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Storage Engine for Salon Photo Uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage });

// In-Memory Database (Production me isse PostgreSQL ya MongoDB se replace karein)
let shops = [
  {
    id: "shop_1",
    name: "Royal Look Salon",
    ownerName: "Ramesh Sharma",
    phone: "9876543210",
    lat: 28.6139,
    lng: 77.2090,
    address: "Connaught Place, New Delhi",
    services: [
      { name: "Haircut", price: 150, duration: 30 },
      { name: "Beard Trim", price: 80, duration: 15 }
    ],
    rating: 4.8,
    reviewsCount: 24,
    images: ["https://images.unsplash.com/photo-1503951914875-452162b0f3f1?w=500"],
    queue: []
  }
];

// API: Fetch Nearby Shops based on Lat/Lng Distance
app.get('/api/shops/nearby', (req, res) => {
  const userLat = parseFloat(req.query.lat);
  const userLng = parseFloat(req.query.lng);

  // Haversine Formula for Distance Calculation (in Km)
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

  const nearby = shops.map(shop => {
    const dist = calculateDistance(userLat, userLng, shop.lat, shop.lng);
    return { ...shop, distanceKm: dist.toFixed(2) };
  }).sort((a, b) => a.distanceKm - b.distanceKm);

  res.json(nearby);
});

// API: Register New Salon
app.post('/api/shops/register', upload.array('photos', 5), (req, res) => {
  const { name, ownerName, phone, lat, lng, address, services } = req.body;
  const imagePaths = req.files ? req.files.map(f => `/uploads/${f.filename}`) : [];

  const newShop = {
    id: `shop_${Date.now()}`,
    name,
    ownerName,
    phone,
    lat: parseFloat(lat),
    lng: parseFloat(lng),
    address,
    services: JSON.parse(services || '[]'),
    rating: 5.0,
    reviewsCount: 1,
    images: imagePaths.length ? imagePaths : ["https://images.unsplash.com/photo-1503951914875-452162b0f3f1?w=500"],
    queue: []
  };

  shops.push(newShop);
  res.status(201).json({ success: true, shop: newShop });
});

// Socket.io Real-time Live Queue Logic
io.on('connection', (socket) => {
  console.log('New client connected:', socket.id);

  socket.on('join_shop', (shopId) => {
    socket.join(shopId);
  });

  socket.on('book_appointment', ({ shopId, customerName, serviceName, duration }) => {
    const shop = shops.find(s => s.id === shopId);
    if (shop) {
      const tokenNumber = shop.queue.length + 1;
      const totalWaitMinutes = shop.queue.reduce((acc, curr) => acc + curr.duration, 0);
      
      const newBooking = {
        tokenNumber,
        customerName,
        serviceName,
        duration: parseInt(duration),
        estimatedWait: totalWaitMinutes,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };

      shop.queue.push(newBooking);

      // Real-time update broadcast to everyone viewing this shop
      io.to(shopId).emit('queue_updated', { queue: shop.queue, shopId });
      socket.emit('booking_confirmed', newBooking);
    }
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server running live on port ${PORT}`);
});
