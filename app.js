const socket = io();
let userLat = 28.6139;
let userLng = 77.2090;
let map, userMarker;
let selectedShop = null;
let selectedService = null;

// Register Service Worker
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js');
}

// Initialize Leaflet Map
function initMap() {
  map = L.map('map').setView([userLat, userLng], 13);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19
  }).addTo(map);

  userMarker = L.marker([userLat, userLng]).addTo(map).bindPopup("Aap yahan hain!").openPopup();
}

// Get Geolocation
function getUserLocation() {
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        userLat = pos.coords.latitude;
        userLng = pos.coords.longitude;
        document.getElementById('location-text').innerText = `${userLat.toFixed(3)}, ${userLng.toFixed(3)}`;
        
        if (map) {
          map.setView([userLat, userLng], 14);
          userMarker.setLatLng([userLat, userLng]);
        }
        fetchNearbyShops();
      },
      () => {
        document.getElementById('location-text').innerText = "Default (Delhi)";
        fetchNearbyShops();
      }
    );
  }
}

// Fetch Nearby Shops from Backend API
async function fetchNearbyShops() {
  const res = await fetch(`/api/shops/nearby?lat=${userLat}&lng=${userLng}`);
  const shops = await res.json();
  
  const container = document.getElementById('shop-list');
  container.innerHTML = '';

  shops.forEach(shop => {
    // Add Marker on Map
    L.marker([shop.lat, shop.lng]).addTo(map).bindPopup(`<b>${shop.name}</b>`);

    // Render Cards
    const card = document.createElement('div');
    card.className = "bg-slate-800 p-4 rounded-xl border border-slate-700 flex flex-col space-y-3";
    card.innerHTML = `
      <div class="flex space-x-3">
        <img src="${shop.images[0]}" class="w-20 h-20 rounded-lg object-cover">
        <div class="flex-1">
          <h3 class="font-bold text-lg text-amber-400">${shop.name}</h3>
          <p class="text-xs text-slate-400">📍 ${shop.address} (${shop.distanceKm} km away)</p>
          <div class="flex items-center space-x-2 mt-1">
            <span class="text-xs bg-amber-500/20 text-amber-400 px-2 py-0.5 rounded font-bold">★ ${shop.rating}</span>
            <span class="text-xs text-slate-400">👥 Queue: ${shop.queue.length} People</span>
          </div>
        </div>
      </div>
      <button onclick="openBookingModal('${shop.id}')" class="w-full bg-slate-700 hover:bg-slate-600 text-amber-400 text-sm font-bold py-2 rounded-lg">
        Book Appointment / View Live Queue
      </button>
    `;
    container.appendChild(card);
  });
}

// Open Booking Modal
async function openBookingModal(shopId) {
  const res = await fetch(`/api/shops/nearby?lat=${userLat}&lng=${userLng}`);
  const shops = await res.json();
  selectedShop = shops.find(s => s.id === shopId);

  socket.emit('join_shop', shopId);

  document.getElementById('modal-shop-name').innerText = selectedShop.name;
  document.getElementById('modal-queue-count').innerText = selectedShop.queue.length;
  
  const totalWait = selectedShop.queue.reduce((acc, curr) => acc + curr.duration, 0);
  document.getElementById('modal-wait-time').innerText = `${totalWait} mins`;

  const serviceContainer = document.getElementById('services-list');
  serviceContainer.innerHTML = '<p class="text-sm font-semibold text-slate-300">Select Service:</p>';

  selectedShop.services.forEach((s, idx) => {
    serviceContainer.innerHTML += `
      <label class="flex items-center justify-between bg-slate-900 p-2.5 rounded-lg border border-slate-700 cursor-pointer">
        <div class="flex items-center space-x-2">
          <input type="radio" name="service" value="${idx}" onchange="selectedService = selectedShop.services[${idx}]" class="accent-amber-500">
          <span class="text-sm">${s.name} (${s.duration} mins)</span>
        </div>
        <span class="text-sm font-bold text-amber-400">₹${s.price}</span>
      </label>
    `;
  });

  document.getElementById('booking-modal').classList.remove('hidden');
  document.getElementById('booking-modal').classList.add('flex');
}

function closeBookingModal() {
  document.getElementById('booking-modal').classList.add('hidden');
  document.getElementById('booking-modal').classList.remove('flex');
}

function toggleRegisterModal() {
  const modal = document.getElementById('register-modal');
  modal.classList.toggle('hidden');
  modal.classList.toggle('flex');
}

// Submit Booking
function confirmBooking() {
  const name = document.getElementById('cust-name').value;
  if (!name || !selectedService) {
    alert('Kripya apna naam aur service chunein!');
    return;
  }

  socket.emit('book_appointment', {
    shopId: selectedShop.id,
    customerName: name,
    serviceName: selectedService.name,
    duration: selectedService.duration
  });
}

// Socket Listener: Confirmation & Real-time Live Queue Updates
socket.on('booking_confirmed', (data) => {
  alert(`Booking Success! Token #${data.tokenNumber}. Approx Watch Time: ${data.estimatedWait} minutes.`);
  closeBookingModal();
  fetchNearbyShops();
});

socket.on('queue_updated', ({ queue, shopId }) => {
  if (selectedShop && selectedShop.id === shopId) {
    document.getElementById('modal-queue-count').innerText = queue.length;
    const totalWait = queue.reduce((acc, curr) => acc + curr.duration, 0);
    document.getElementById('modal-wait-time').innerText = `${totalWait} mins`;
  }
});

// Initialize on Load
window.onload = () => {
  initMap();
  getUserLocation();
};