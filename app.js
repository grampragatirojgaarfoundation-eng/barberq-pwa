const socket = io();
let userLat = 28.6139, userLng = 77.2090;
let map, userMarker, allShops = [], shopMarkers = {};
let selectedShop = null, selectedService = null, selectedSlotTime = null;
let ownerPhone = localStorage.getItem('barberq_owner_phone') || null;
let formClosedDates = []; 
let selectedPhotosToUpload = []; 

const redIcon = new L.Icon({ iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png', iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34] });
const blueIcon = new L.Icon({ iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-blue.png', iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34] });

function initMap() {
  map = L.map('map').setView([userLat, userLng], 13);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);
  userMarker = L.marker([userLat, userLng], {icon: redIcon}).addTo(map).bindPopup("You");
}

function getUserLocation() {
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      (pos) => { userLat = pos.coords.latitude; userLng = pos.coords.longitude; if(map){ map.setView([userLat, userLng], 14); userMarker.setLatLng([userLat, userLng]); } fetchNearbyShops(); },
      () => { fetchNearbyShops(); }
    );
  }
}

async function fetchNearbyShops() {
  const res = await fetch(`/api/shops/nearby?lat=${userLat}&lng=${userLng}`);
  allShops = await res.json();
  const container = document.getElementById('shop-list'); container.innerHTML = '';
  Object.values(shopMarkers).forEach(m => map.removeLayer(m)); shopMarkers = {};

  allShops.forEach(shop => {
    const marker = L.marker([shop.location.coordinates[1], shop.location.coordinates[0]], {icon: blueIcon}).addTo(map).bindPopup(`<b>${shop.shopName}</b>`);
    marker.on('click', () => openProfile(shop._id)); shopMarkers[shop._id] = marker;
    
    container.innerHTML += `
      <div class="bg-slate-800 p-4 rounded-xl border border-slate-700 cursor-pointer hover:border-amber-500 transition flex space-x-3" onclick="openProfile('${shop._id}')">
        <img src="${shop.photos[0] || 'https://via.placeholder.com/100'}" class="w-20 h-20 rounded-lg object-cover">
        <div class="flex-1">
          <div class="flex justify-between items-start"><h3 class="font-bold text-amber-400">${shop.shopName}</h3></div>
          <p class="text-xs text-slate-400">📍 ${shop.distanceKm} km away</p>
        </div>
      </div>`;
  });
}

function openProfile(shopId) {
  selectedShop = allShops.find(s => s._id === shopId);
  Object.keys(shopMarkers).forEach(id => shopMarkers[id].setIcon(id === shopId ? redIcon : blueIcon));
  map.setView([selectedShop.location.coordinates[1], selectedShop.location.coordinates[0]], 15);

  document.getElementById('prof-name').innerText = selectedShop.shopName;
  document.getElementById('prof-address').innerText = "📍 " + selectedShop.address;
  
  const gal = document.getElementById('prof-gallery'); 
  gal.innerHTML = '';
  if (selectedShop.photos && selectedShop.photos.length > 0) {
      selectedShop.photos.forEach((src, index) => {
          let extraClass = index === 0 ? "col-span-4 h-48" : "col-span-1 h-20";
          gal.innerHTML += `<img src="${src}" onclick="openLightbox('${src}')" class="w-full ${extraClass} rounded-lg object-cover cursor-pointer border border-slate-600 hover:opacity-80 transition">`;
      });
  } else {
      gal.innerHTML = `<p class="text-xs text-slate-500 col-span-4">No photos uploaded by owner.</p>`;
  }

  const sList = document.getElementById('prof-services'); sList.innerHTML = '';
  selectedShop.services.forEach((s, idx) => {
      sList.innerHTML += `
        <label class="flex items-center justify-between p-2 hover:bg-blue-50 rounded cursor-pointer border-b border-slate-100 last:border-0">
          <div class="flex space-x-2 items-center"><input type="radio" name="service" value="${idx}" onchange="selectedService = selectedShop.services[${idx}]; checkBookingBtn();" class="accent-blue-600 w-4 h-4">
          <div><p class="text-sm font-bold text-slate-800">${s.name}</p></div></div>
          <span class="text-sm font-bold text-blue-700">₹${s.price}</span>
        </label>`;
  });

  const dateInput = document.getElementById('book-date');
  const today = new Date();
  const maxDate = new Date();
  maxDate.setDate(today.getDate() + 5); 
  
  dateInput.min = today.toLocaleDateString('en-CA');
  dateInput.max = maxDate.toLocaleDateString('en-CA');
  dateInput.value = dateInput.min;
  
  loadSlots();

  if(ownerPhone === selectedShop.phone) document.getElementById('owner-actions').classList.remove('hidden');
  else document.getElementById('owner-actions').classList.add('hidden');

  document.getElementById('profile-modal').classList.remove('hidden'); document.getElementById('profile-modal').classList.add('flex');
}

function closeProfile() {
  document.getElementById('profile-modal').classList.replace('flex', 'hidden');
  selectedSlotTime = null; selectedService = null;
  if(selectedShop && shopMarkers[selectedShop._id]) shopMarkers[selectedShop._id].setIcon(blueIcon);
}

function openLightbox(src) { document.getElementById('lightbox-img').src = src; document.getElementById('lightbox-modal').classList.replace('hidden', 'flex'); }
function closeLightbox() { document.getElementById('lightbox-modal').classList.replace('flex', 'hidden'); }

// ==========================================
// UIDAI SLOT LOGIC & DASHBOARD
// ==========================================
async function loadSlots() {
    const date = document.getElementById('book-date').value;
    if(!date) return;
    
    selectedSlotTime = null; checkBookingBtn();
    
    const res = await fetch(`/api/shops/${selectedShop._id}/slots?date=${date}`);
    const data = await res.json();
    
    const grid = document.getElementById('slot-grid');
    grid.innerHTML = '';
    
    if(data.isClosed) {
        document.getElementById('closed-overlay').classList.replace('hidden','flex');
        document.getElementById('slot-total-tokens').innerText = "0";
        document.getElementById('slot-avail-tokens').innerText = "0";
        return;
    } else {
        document.getElementById('closed-overlay').classList.replace('flex','hidden');
    }
    
    let totalCap = 0, availCap = 0;

    data.slots.forEach(slot => {
        totalCap += slot.total; availCap += slot.available;
        let isFull = slot.available === 0;
        let btnClass = isFull ? 'bg-slate-200 text-slate-400 border-slate-300 cursor-not-allowed' : 'bg-white text-slate-800 border-slate-400 hover:border-blue-600 cursor-pointer shadow-sm';
        grid.innerHTML += `
          <div id="slot-btn-${slot.time.replace(/\s/g,'')}" class="uidai-slot border rounded-md p-1.5 text-center flex flex-col items-center justify-center ${btnClass}"
               onclick="${isFull ? '' : `selectSlot('${slot.time}')`}">
             <p class="text-[11px] font-bold">${slot.time}</p>
             <p class="text-[9px] ${isFull ? 'text-red-500' : 'text-green-600'} font-bold">Available: ${slot.available}</p>
          </div>
        `;
    });
    
    document.getElementById('slot-total-tokens').innerText = totalCap;
    document.getElementById('slot-avail-tokens').innerText = availCap;

    if(ownerPhone === selectedShop.phone) {
        document.getElementById('owner-dashboard').classList.remove('hidden');
        const dashList = document.getElementById('owner-bookings-list');
        dashList.innerHTML = '';
        if(data.bookings.length === 0) dashList.innerHTML = '<p class="text-xs text-slate-400">No bookings for this date.</p>';
        data.bookings.forEach(b => {
            dashList.insertAdjacentHTML('beforeend', `
              <div class="bg-slate-700 p-2 rounded flex justify-between text-xs border border-slate-600 mb-2">
                 <div><p class="font-bold text-amber-400">${b.tokenNumber}</p><p class="text-white font-bold">${b.timeSlot}</p></div>
                 <div class="text-right"><p class="text-slate-300 font-bold">${b.customerName}</p><p class="text-slate-400">${b.customerPhone}</p></div>
              </div>`);
        });
    } else {
        document.getElementById('owner-dashboard').classList.add('hidden');
    }
}

function selectSlot(time) {
    if(selectedSlotTime) document.getElementById(`slot-btn-${selectedSlotTime.replace(/\s/g,'')}`).classList.remove('selected');
    selectedSlotTime = time;
    document.getElementById(`slot-btn-${selectedSlotTime.replace(/\s/g,'')}`).classList.add('selected');
    checkBookingBtn();
}

function checkBookingBtn() {
    const btn = document.getElementById('book-btn');
    if(selectedSlotTime && selectedService) btn.disabled = false; else btn.disabled = true;
}

// ==========================================
// FORM, HOLIDAYS & 5-PHOTO QUEUE LOGIC
// ==========================================
function loginAsOwner() {
    const p = prompt("Enter your registered Shop Mobile Number:");
    if(p) { localStorage.setItem('barberq_owner_phone', p); ownerPhone = p; alert("Owner mode activated!"); location.reload(); }
}

function openFormModal(mode) {
    document.getElementById('form-modal').classList.replace('hidden', 'flex');
    document.getElementById('dynamic-services').innerHTML = ''; 
    formClosedDates = []; selectedPhotosToUpload = []; renderHolidays(); renderPhotoQueue();
    
    if(mode === 'register') {
        document.getElementById('form-shopId').value = "";
        ['reg-name', 'reg-owner', 'reg-phone', 'reg-address', 'reg-lat', 'reg-lng'].forEach(id => document.getElementById(id).value = "");
        document.getElementById('reg-open').value = "09:00"; document.getElementById('reg-close').value = "21:00";
        document.getElementById('reg-dur').value = "30"; document.getElementById('reg-chair').value = "1";
        addServiceRow();
    } else {
        document.getElementById('form-title').innerText = "Edit Settings";
        document.getElementById('form-shopId').value = selectedShop._id;
        document.getElementById('reg-name').value = selectedShop.shopName; document.getElementById('reg-owner').value = selectedShop.ownerName;
        document.getElementById('reg-phone').value = selectedShop.phone; document.getElementById('reg-address').value = selectedShop.address;
        document.getElementById('reg-lat').value = selectedShop.location.coordinates[1]; document.getElementById('reg-lng').value = selectedShop.location.coordinates[0];
        document.getElementById('reg-open').value = selectedShop.openingTime; document.getElementById('reg-close').value = selectedShop.closingTime;
        document.getElementById('reg-dur').value = selectedShop.slotDuration; document.getElementById('reg-chair').value = selectedShop.chairs;
        
        formClosedDates = selectedShop.closedDates || []; renderHolidays();
        selectedShop.services.forEach(s => addServiceRow(s.name, s.price));
    }
}
function closeFormModal() { document.getElementById('form-modal').classList.replace('flex', 'hidden'); }

// FIX 3: Robust Javascript Timezone-Proof Date Looping
function addHolidayRange() {
    let startStr = document.getElementById('holiday-start').value;
    let endStr = document.getElementById('holiday-end').value;
    if(!startStr) return alert("Please select 'From Date'");
    if(!endStr) endStr = startStr; 
    
    let [sY, sM, sD] = startStr.split('-').map(Number);
    let [eY, eM, eD] = endStr.split('-').map(Number);
    
    let startDate = new Date(sY, sM - 1, sD);
    let endDate = new Date(eY, eM - 1, eD);

    if(startDate > endDate) return alert("From Date cannot be after To Date");

    while(startDate <= endDate) {
        let yyyy = startDate.getFullYear();
        let mm = String(startDate.getMonth() + 1).padStart(2, '0');
        let dd = String(startDate.getDate()).padStart(2, '0');
        let dStr = `${yyyy}-${mm}-${dd}`;
        if(!formClosedDates.includes(dStr)) formClosedDates.push(dStr);
        startDate.setDate(startDate.getDate() + 1);
    }
    renderHolidays();
    document.getElementById('holiday-start').value = ''; document.getElementById('holiday-end').value = '';
}
function removeHoliday(dateVal) { formClosedDates = formClosedDates.filter(d => d !== dateVal); renderHolidays(); }
function renderHolidays() {
    const list = document.getElementById('holiday-list'); list.innerHTML = '';
    formClosedDates.forEach(d => {
        list.innerHTML += `<span class="bg-red-500/20 text-red-400 text-[10px] font-bold px-2 py-1 rounded flex items-center space-x-1"><span>${d}</span><button type="button" onclick="removeHoliday('${d}')" class="text-white ml-1 bg-red-600 rounded-full w-4 h-4 flex items-center justify-center">×</button></span>`;
    });
}

function handlePhotoSelect(input) {
    if(selectedPhotosToUpload.length + input.files.length > 5) { alert("Maximum 5 photos allowed!"); return; }
    for(let file of input.files) {
        if(file.size > 1024 * 1024) { alert(`File ${file.name} is larger than 1MB!`); continue; }
        selectedPhotosToUpload.push(file);
    }
    input.value = ''; renderPhotoQueue();
}
function removePhotoFromQueue(index) { selectedPhotosToUpload.splice(index, 1); renderPhotoQueue(); }
function renderPhotoQueue() {
    const list = document.getElementById('photo-preview-list'); list.innerHTML = '';
    document.getElementById('photo-count-text').innerText = `${selectedPhotosToUpload.length}/5 added`;
    selectedPhotosToUpload.forEach((file, idx) => {
        const url = URL.createObjectURL(file);
        list.innerHTML += `<div class="relative"><img src="${url}" class="w-12 h-12 rounded object-cover border border-slate-500"><button type="button" onclick="removePhotoFromQueue(${idx})" class="absolute -top-2 -right-2 bg-red-600 text-white text-[10px] w-5 h-5 rounded-full font-bold">×</button></div>`;
    });
}

function addServiceRow(n='', p='') {
    const row = document.createElement('div'); row.className = "flex space-x-2 service-row";
    row.innerHTML = `<input type="text" value="${n}" placeholder="Service" class="s-name w-1/2 bg-slate-800 p-2 rounded text-xs text-white border border-slate-600"><input type="number" value="${p}" placeholder="₹" class="s-price w-1/4 bg-slate-800 p-2 rounded text-xs text-white border border-slate-600">`;
    document.getElementById('dynamic-services').appendChild(row);
}
function getCurrentLocationForReg() { navigator.geolocation.getCurrentPosition((pos) => { document.getElementById('reg-lat').value = pos.coords.latitude; document.getElementById('reg-lng').value = pos.coords.longitude; }); }

// FIX 1: Robust Edit Update Function
async function submitForm() {
  const shopId = document.getElementById('form-shopId').value, isEdit = shopId !== "";
  
  const lat = document.getElementById('reg-lat').value;
  const lng = document.getElementById('reg-lng').value;
  if(!lat || !lng) return alert("Kripya Latitude/Longitude zaroor bharein (Auto par click karein)!");

  const formData = new FormData();
  formData.append('name', document.getElementById('reg-name').value); formData.append('ownerName', document.getElementById('reg-owner').value);
  formData.append('phone', document.getElementById('reg-phone').value); formData.append('address', document.getElementById('reg-address').value);
  formData.append('lat', lat); formData.append('lng', lng);
  formData.append('openingTime', document.getElementById('reg-open').value || "09:00"); formData.append('closingTime', document.getElementById('reg-close').value || "21:00");
  formData.append('slotDuration', document.getElementById('reg-dur').value); formData.append('chairs', document.getElementById('reg-chair').value);
  formData.append('closedDates', JSON.stringify(formClosedDates)); 

  const sArr = [];
  document.querySelectorAll('.service-row').forEach(row => {
      const n = row.querySelector('.s-name').value, p = row.querySelector('.s-price').value;
      if(n && p) sArr.push({ name: n, price: parseInt(p), duration: 0 }); 
  });
  formData.append('services', JSON.stringify(sArr));
  
  selectedPhotosToUpload.forEach(file => formData.append('photos', file));

  const btn = document.getElementById('submit-btn');
  try {
      btn.innerText = "Processing... Please wait"; btn.disabled = true;
      const res = await fetch(isEdit ? `/api/shops/${shopId}` : `/api/shops/register`, { method: isEdit ? 'PUT' : 'POST', body: formData });
      const data = await res.json();
      if(res.ok && data.success) { 
          alert(isEdit ? "Profile Successfully Updated!" : "Salon Live!"); 
          closeFormModal(); if(isEdit) closeProfile(); fetchNearbyShops(); 
      } else { alert("Error: " + (data.error || "Save Failed")); }
  } catch (err) { alert("Action failed! Check connection."); console.error(err); } 
  finally { btn.innerText = "Save Profile"; btn.disabled = false; }
}

// Booking System
function confirmBooking() {
  const name = document.getElementById('cust-name').value, phone = document.getElementById('cust-phone').value;
  const date = document.getElementById('book-date').value;
  if (!name || !phone || !selectedService || !selectedSlotTime) return alert('Kripya saari details bharein!');
  
  document.getElementById('book-btn').innerText = "Booking...";
  socket.emit('book_appointment', { shopId: selectedShop._id, customerName: name, customerPhone: phone, serviceName: selectedService.name, bookingDate: date, timeSlot: selectedSlotTime });
}

// FIX 4: PDF DOWNLOAD FUNCTION & MODAL CLOSE FUNCTION
function downloadTokenPDF() {
    const btn = document.getElementById('pdf-download-btn');
    btn.innerText = "Preparing PDF...";
    
    const element = document.getElementById('printable-slip');
    const opt = {
        margin:       0.5,
        filename:     `BarberQ_Token_${Math.floor(Math.random()*1000)}.pdf`,
        image:        { type: 'jpeg', quality: 0.98 },
        html2canvas:  { scale: 2 },
        jsPDF:        { unit: 'in', format: 'letter', orientation: 'portrait' }
    };
    html2pdf().set(opt).from(element).save().then(() => {
        btn.innerText = "Download PDF";
    }).catch(err => {
        alert("PDF Generation Failed, trying alternative print.");
        window.print();
        btn.innerText = "Download PDF";
    });
}

function closeTokenModal() {
    document.getElementById('token-modal').classList.replace('flex','hidden');
}

socket.on('booking_error', (data) => {
    alert("Error: " + data.message);
    document.getElementById('book-btn').innerText = "Confirm Appointment";
});

socket.on('booking_confirmed', (data) => {
  document.getElementById('book-btn').innerText = "Confirm Appointment";
  
  document.getElementById('display-shop-name').innerText = data.shopName;
  document.getElementById('display-shop-address').innerText = data.shopAddress;
  document.getElementById('display-shop-phone').innerText = "📞 Contact: " + data.shopPhone;
  document.getElementById('display-cust-name').innerText = data.customerName; // Naya Added
  document.getElementById('display-token').innerText = data.tokenNumber;
  document.getElementById('display-time').innerText = data.appointmentTime;
  
  document.getElementById('token-modal').classList.replace('hidden', 'flex');
  loadSlots(); 
});

socket.on('slot_booked', ({ shopId, bookingDate }) => {
   if (selectedShop && selectedShop._id === shopId && document.getElementById('book-date').value === bookingDate) {
       loadSlots();
   }
});

window.onload = () => { initMap(); getUserLocation(); };