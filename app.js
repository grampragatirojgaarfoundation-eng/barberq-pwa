const socket = io();
let userLat = 28.6139;
let userLng = 77.2090;
let map, userMarker;
let allShops = [];
let selectedShop = null;
let selectedService = null;
let shopMarkers = {}; // Markers ko track karne ke liye
let ownerPhone = localStorage.getItem('barberq_owner_phone') || null;

// Red & Blue Leaflet Icons
const redIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
  iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34]
});
const blueIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-blue.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
  iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34]
});

function initMap() {
  map = L.map('map').setView([userLat, userLng], 13);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);
  userMarker = L.marker([userLat, userLng], {icon: redIcon}).addTo(map).bindPopup("You");
}

function getUserLocation() {
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition((pos) => {
        userLat = pos.coords.latitude; userLng = pos.coords.longitude;
        if (map) { map.setView([userLat, userLng], 14); userMarker.setLatLng([userLat, userLng]); }
        fetchNearbyShops();
      },
      () => { fetchNearbyShops(); }
    );
  }
}

// Map par click karne se Profile Khulegi
async function fetchNearbyShops() {
  const res = await fetch(`/api/shops/nearby?lat=${userLat}&lng=${userLng}`);
  allShops = await res.json();
  const container = document.getElementById('shop-list');
  container.innerHTML = '';

  // Clear old markers
  Object.values(shopMarkers).forEach(m => map.removeLayer(m));
  shopMarkers = {};

  allShops.forEach(shop => {
    // Add Blue Marker
    const marker = L.marker([shop.location.coordinates[1], shop.location.coordinates[0]], {icon: blueIcon})
      .addTo(map).bindPopup(`<b>${shop.shopName}</b><br>Click to open profile`);
    
    // Marker Click = Open Profile
    marker.on('click', () => openProfile(shop._id));
    shopMarkers[shop._id] = marker;

    // List Card
    const card = document.createElement('div');
    card.className = "bg-slate-800 p-4 rounded-xl border border-slate-700 cursor-pointer hover:border-amber-500 transition flex space-x-3";
    card.onclick = () => openProfile(shop._id);
    
    let badge = shop.isOpenToday ? `<span class="bg-green-500/20 text-green-400 px-2 py-0.5 rounded text-[10px] font-bold">OPEN</span>` 
                                 : `<span class="bg-red-500/20 text-red-400 px-2 py-0.5 rounded text-[10px] font-bold">CLOSED</span>`;
    
    card.innerHTML = `
        <img src="${shop.photos[0] || ''}" class="w-20 h-20 rounded-lg object-cover">
        <div class="flex-1">
          <div class="flex justify-between items-start">
             <h3 class="font-bold text-amber-400">${shop.shopName}</h3>
             ${badge}
          </div>
          <p class="text-xs text-slate-400">📍 ${shop.distanceKm} km away</p>
          <p class="text-xs text-slate-300 mt-1">👥 Queue: ${shop.queue.length}</p>
        </div>`;
    container.appendChild(card);
  });
}

// ==========================================
// NEW FEATURE: FULL PROFILE & MARKER COLOR
// ==========================================
function openProfile(shopId) {
  selectedShop = allShops.find(s => s._id === shopId);
  socket.emit('join_shop', shopId);

  // Sabhi markers ko wapas blue karo, sirf selected ko red karo
  Object.keys(shopMarkers).forEach(id => {
      shopMarkers[id].setIcon(id === shopId ? redIcon : blueIcon);
  });
  map.setView([selectedShop.location.coordinates[1], selectedShop.location.coordinates[0]], 15);

  // Profile Details Bharna
  document.getElementById('prof-name').innerText = selectedShop.shopName;
  document.getElementById('prof-address').innerText = "📍 " + selectedShop.address;
  document.getElementById('prof-timing').innerText = `${selectedShop.openingTime} - ${selectedShop.closingTime}`;
  document.getElementById('prof-owner').innerText = selectedShop.ownerName;
  document.getElementById('prof-call').href = `tel:${selectedShop.phone}`;

  const statusEl = document.getElementById('prof-status');
  if(selectedShop.isOpenToday) {
      statusEl.innerText = "OPEN NOW"; statusEl.className = "px-3 py-1 rounded-full text-xs font-bold bg-green-500 text-slate-900";
      document.getElementById('book-btn').disabled = false;
      document.getElementById('book-btn').innerText = "Get Live Token";
      document.getElementById('book-btn').classList.replace('bg-slate-600', 'bg-amber-500');
  } else {
      statusEl.innerText = "SHOP CLOSED"; statusEl.className = "px-3 py-1 rounded-full text-xs font-bold bg-red-500 text-white";
      document.getElementById('book-btn').disabled = true;
      document.getElementById('book-btn').innerText = "Closed for Booking";
      document.getElementById('book-btn').classList.replace('bg-amber-500', 'bg-slate-600');
  }

  // Gallery (Max 5 Photos)
  const gal = document.getElementById('prof-gallery');
  gal.innerHTML = '';
  selectedShop.photos.forEach(src => {
      gal.innerHTML += `<img src="${src}" onclick="openLightbox('${src}')" class="w-32 h-32 rounded-lg object-cover snap-center cursor-pointer border border-slate-600">`;
  });

  // Services Radio Buttons
  const sList = document.getElementById('prof-services');
  sList.innerHTML = '';
  selectedShop.services.forEach((s, idx) => {
      sList.innerHTML += `
        <label class="flex items-center justify-between bg-slate-900 p-3 rounded-lg border border-slate-700 cursor-pointer">
          <div class="flex space-x-3">
            <input type="radio" name="service" value="${idx}" onchange="selectedService = selectedShop.services[${idx}]" class="accent-amber-500 w-4 h-4 mt-1">
            <div><p class="text-sm font-bold text-white">${s.name}</p><p class="text-xs text-slate-400">⏱ ${s.duration} mins</p></div>
          </div>
          <span class="text-sm font-bold text-amber-400">₹${s.price}</span>
        </label>`;
  });

  // Queue Data
  document.getElementById('prof-queue').innerText = selectedShop.queue.length;
  document.getElementById('prof-wait').innerText = selectedShop.queue.reduce((acc, curr) => acc + curr.duration, 0) + " mins";

  // Owner Check (Agar localStorage mein owner ka number hai to Edit button dikhega)
  if(ownerPhone === selectedShop.phone) {
      document.getElementById('owner-actions').classList.remove('hidden');
  } else {
      document.getElementById('owner-actions').classList.add('hidden');
  }

  document.getElementById('profile-modal').classList.remove('hidden');
  document.getElementById('profile-modal').classList.add('flex');
}

function closeProfile() {
  document.getElementById('profile-modal').classList.replace('flex', 'hidden');
  // Marker reset
  if(selectedShop && shopMarkers[selectedShop._id]) {
      shopMarkers[selectedShop._id].setIcon(blueIcon);
  }
}

// Lightbox Zoom Logic
function openLightbox(src) {
    document.getElementById('lightbox-img').src = src;
    document.getElementById('lightbox-modal').classList.replace('hidden', 'flex');
}
function closeLightbox() {
    document.getElementById('lightbox-modal').classList.replace('flex', 'hidden');
}

// ==========================================
// OWNER LOGIN & FORM LOGIC
// ==========================================
function loginAsOwner() {
    const p = prompt("Enter your registered Shop Mobile Number to access Edit rights:");
    if(p) {
        localStorage.setItem('barberq_owner_phone', p);
        ownerPhone = p;
        alert("Owner mode activated for this device!");
    }
}

function openFormModal(mode) {
    document.getElementById('form-modal').classList.replace('hidden', 'flex');
    document.getElementById('dynamic-services').innerHTML = ''; // Clear old

    if(mode === 'register') {
        document.getElementById('form-title').innerText = "Register New Salon";
        document.getElementById('form-shopId').value = "";
        ['reg-name', 'reg-owner', 'reg-phone', 'reg-address', 'reg-lat', 'reg-lng'].forEach(id => document.getElementById(id).value = "");
        document.getElementById('reg-open').value = "09:00 AM";
        document.getElementById('reg-close').value = "09:00 PM";
        document.getElementById('status-toggle-container').classList.add('hidden');
        addServiceRow();
    } else {
        // Edit Mode (Pre-fill details)
        document.getElementById('form-title').innerText = "Edit Your Salon";
        document.getElementById('form-shopId').value = selectedShop._id;
        document.getElementById('reg-name').value = selectedShop.shopName;
        document.getElementById('reg-owner').value = selectedShop.ownerName;
        document.getElementById('reg-phone').value = selectedShop.phone;
        document.getElementById('reg-address').value = selectedShop.address;
        document.getElementById('reg-lat').value = selectedShop.location.coordinates[1];
        document.getElementById('reg-lng').value = selectedShop.location.coordinates[0];
        document.getElementById('reg-open').value = selectedShop.openingTime;
        document.getElementById('reg-close').value = selectedShop.closingTime;
        
        document.getElementById('status-toggle-container').classList.replace('hidden', 'flex');
        document.getElementById('reg-status').checked = selectedShop.isOpenToday;

        selectedShop.services.forEach(s => addServiceRow(s.name, s.price, s.duration));
    }
}
function closeFormModal() { document.getElementById('form-modal').classList.replace('flex', 'hidden'); }

function addServiceRow(n='', p='', d='') {
    const row = document.createElement('div'); row.className = "flex space-x-2 service-row";
    row.innerHTML = `<input type="text" value="${n}" placeholder="Service" class="s-name w-1/2 bg-slate-800 p-2 rounded text-xs text-white border border-slate-600">
                     <input type="number" value="${p}" placeholder="₹" class="s-price w-1/4 bg-slate-800 p-2 rounded text-xs text-white border border-slate-600">
                     <input type="number" value="${d}" placeholder="Mins" class="s-dur w-1/4 bg-slate-800 p-2 rounded text-xs text-white border border-slate-600">`;
    document.getElementById('dynamic-services').appendChild(row);
}
function getCurrentLocationForReg() {
    navigator.geolocation.getCurrentPosition((pos) => {
        document.getElementById('reg-lat').value = pos.coords.latitude;
        document.getElementById('reg-lng').value = pos.coords.longitude;
    });
}

// Single Submit Function (Handles both POST for new and PUT for Edit)
async function submitForm() {
  const shopId = document.getElementById('form-shopId').value;
  const isEdit = shopId !== "";
  const formData = new FormData();
  
  formData.append('name', document.getElementById('reg-name').value);
  formData.append('ownerName', document.getElementById('reg-owner').value);
  formData.append('phone', document.getElementById('reg-phone').value);
  formData.append('address', document.getElementById('reg-address').value);
  formData.append('lat', document.getElementById('reg-lat').value);
  formData.append('lng', document.getElementById('reg-lng').value);
  formData.append('openingTime', document.getElementById('reg-open').value);
  formData.append('closingTime', document.getElementById('reg-close').value);
  if(isEdit) formData.append('isOpenToday', document.getElementById('reg-status').checked);

  const sArr = [];
  document.querySelectorAll('.service-row').forEach(row => {
      const n = row.querySelector('.s-name').value, p = row.querySelector('.s-price').value, d = row.querySelector('.s-dur').value;
      if(n && p && d) sArr.push({ name: n, price: parseInt(p), duration: parseInt(d) });
  });
  formData.append('services', JSON.stringify(sArr));
  
  const photoInput = document.getElementById('reg-photos');
  for(let i = 0; i < photoInput.files.length; i++) { if(i < 5) formData.append('photos', photoInput.files[i]); }

  const btn = document.getElementById('submit-btn');
  try {
      btn.innerText = "Processing... Please wait"; btn.disabled = true;
      const url = isEdit ? `/api/shops/${shopId}` : `/api/shops/register`;
      const method = isEdit ? 'PUT' : 'POST';

      const res = await fetch(url, { method: method, body: formData });
      const data = await res.json();
      
      if(data.success) {
          alert(isEdit ? "Profile Successfully Updated! Old photos deleted." : "Salon Live Ho Gaya Hai!");
          closeFormModal();
          if(isEdit) closeProfile();
          fetchNearbyShops(); 
      } else { alert("Error: " + data.error); }
  } catch (err) { alert("Action failed!"); } 
  finally { btn.innerText = "Save Profile"; btn.disabled = false; }
}

// Booking System
function confirmBooking() {
  const name = document.getElementById('cust-name').value, phone = document.getElementById('cust-phone').value;
  if (!name || !phone || !selectedService) return alert('Naam, Number aur Service select karein!');
  socket.emit('book_appointment', { shopId: selectedShop._id, customerName: name, customerPhone: phone, serviceName: selectedService.name, duration: selectedService.duration });
}
socket.on('booking_confirmed', (data) => {
  document.getElementById('display-token').innerText = data.tokenNumber;
  document.getElementById('display-time').innerText = data.appointmentTime;
  document.getElementById('token-modal').classList.replace('hidden', 'flex');
  fetchNearbyShops(); // Refresh queue
});
socket.on('queue_updated', ({ queue, shopId }) => {
  if (selectedShop && selectedShop._id === shopId) {
    document.getElementById('prof-queue').innerText = queue.length;
    document.getElementById('prof-wait').innerText = queue.reduce((acc, curr) => acc + curr.duration, 0) + " mins";
  }
});

window.onload = () => { initMap(); getUserLocation(); };