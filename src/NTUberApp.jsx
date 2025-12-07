import React, { useState, useEffect, useRef } from 'react';
import { ethers } from 'ethers'; // 引入 ethers.js
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { 
  MapPin, 
  Navigation, 
  Bike, 
  Star, 
  User, 
  Clock, // 用於顯示時間
  ShieldCheck, 
  Wallet, 
  Menu,
  ChevronLeft,
  Crosshair,
  List,
  Loader2, 
  XCircle,
  History // 用於歷史紀錄圖標
} from 'lucide-react';

/**
 * NTUber DApp - Web3 Integration (Sepolia)
 * 合約地址: 0xa5a5d38a99dcd0863C62347337Bf90093A54eFeE
 * * 功能更新：
 * 1. 新增「我的行程」列表頁面
 * 2. 支援從列表取消特定訂單
 * 3. 優化 Menu 按鈕導航邏輯
 */

// --- 合約設定 ---
const CONTRACT_ADDRESS = "0xa5a5d38a99dcd0863C62347337Bf90093A54eFeE";
const SEPOLIA_CHAIN_ID = '0xaa36a7'; 

// 從 ntuber.sol 推導出的 ABI
const CONTRACT_ABI = [
  "function requestRide(string memory _pickup, string memory _dropoff) public payable",
  "function acceptRide(uint256 _rideId) public",
  "function startRide(uint256 _rideId) public",
  "function completeRide(uint256 _rideId) public",
  "function cancelRide(uint256 _rideId) public", 
  "function rateDriver(uint256 _rideId, uint8 _rating) public",
  "function rideCount() public view returns (uint256)",
  "function getRideDetails(uint256 _rideId) public view returns (tuple(uint256 id, address passenger, address driver, string pickupLocation, string dropoffLocation, uint256 amount, uint256 timestamp, uint8 status, bool isRated, uint8 rating))",
  "event RideRequested(uint256 indexed rideId, address indexed passenger, uint256 amount, string pickup)",
  "event RideAccepted(uint256 indexed rideId, address indexed driver)",
  "event RideStarted(uint256 indexed rideId)",
  "event RideCompleted(uint256 indexed rideId, address indexed driver, uint256 amount)",
  "event RideCancelled(uint256 indexed rideId, address indexed triggerBy)", 
  "event DriverRated(address indexed driver, uint8 rating)"
];

const NTUberApp = () => {
  // --- 狀態管理 ---
  const [role, setRole] = useState('passenger');
  const [walletAddress, setWalletAddress] = useState('');
  const [balance, setBalance] = useState('0.00'); 
  const [appState, setAppState] = useState('IDLE'); // IDLE, HISTORY, WAITING_DRIVER, DRIVER_EN_ROUTE, IN_TRIP, RATING
  
  // 智能合約物件
  const [provider, setProvider] = useState(null);
  const [signer, setSigner] = useState(null);
  const [contract, setContract] = useState(null);

  const [pickup, setPickup] = useState('');
  const [dropoff, setDropoff] = useState('');
  const [pickupCoords, setPickupCoords] = useState(null);
  const [dropoffCoords, setDropoffCoords] = useState(null);
  const [activeField, setActiveField] = useState(null);
  const [estimatedPrice, setEstimatedPrice] = useState(0.001); 
  const [selectedRideType, setSelectedRideType] = useState('NTUber Bike');
  
  const [loading, setLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState(''); 

  // 鏈上數據
  const [allRides, setAllRides] = useState([]); 
  const [myCurrentRide, setMyCurrentRide] = useState(null);

  // --- 輔助功能：解析 Location JSON ---
  const parseLocation = (locString) => {
    try {
      return JSON.parse(locString);
    } catch (e) {
      return { name: locString, lat: 25.0174, lng: 121.5397 };
    }
  };

  const statusMap = ['Created', 'Accepted', 'Ongoing', 'Completed', 'Cancelled'];

  // --- 網路切換輔助函式 ---
  const switchNetwork = async () => {
    if (!window.ethereum) return;
    try {
      const chainId = await window.ethereum.request({ method: 'eth_chainId' });
      if (chainId !== SEPOLIA_CHAIN_ID) {
        await window.ethereum.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: SEPOLIA_CHAIN_ID }],
        });
      }
    } catch (error) {
      console.error("Failed to switch network:", error);
      alert("請務必切換至 Sepolia 測試網！");
    }
  };

  // --- 初始化 ---
  useEffect(() => {
    const initWeb3 = async () => {
      if (window.ethereum) {
        try {
          await switchNetwork();

          const _provider = new ethers.BrowserProvider(window.ethereum);
          const _signer = await _provider.getSigner();
          const _address = await _signer.getAddress();
          const _balance = await _provider.getBalance(_address);
          
          setProvider(_provider);
          setSigner(_signer);
          setWalletAddress(_address);
          setBalance(parseFloat(ethers.formatEther(_balance)).toFixed(4));

          const _contract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, _signer);
          setContract(_contract);

          fetchRides(_contract);
          setupEventListeners(_contract, _address);

          window.ethereum.on('chainChanged', () => {
            window.location.reload();
          });

        } catch (err) {
          console.error("連接錢包失敗:", err);
          alert("請連接 Metamask 以使用此 DApp");
        }
      } else {
        alert("未檢測到錢包！請安裝 Metamask。");
      }
    };

    initWeb3();
    
    return () => {
      if (contract) contract.removeAllListeners();
    };
  }, []); 

  // --- 讀取鏈上數據 ---
  const fetchRides = async (_contract) => {
    try {
      const count = await _contract.rideCount();
      const rides = [];
      // 讀取最近的 20 筆訂單，以便顯示更完整的歷史
      const start = count > 20n ? count - 20n : 1n;
      
      for (let i = Number(count); i >= Number(start); i--) {
        const ride = await _contract.getRideDetails(i);
        const pickupData = parseLocation(ride.pickupLocation);
        const dropoffData = parseLocation(ride.dropoffLocation);
        
        rides.push({
          id: Number(ride.id),
          passenger: ride.passenger,
          driver: ride.driver === ethers.ZeroAddress ? null : ride.driver,
          amount: ethers.formatEther(ride.amount),
          status: statusMap[Number(ride.status)],
          pickup: pickupData.name,
          dropoff: dropoffData.name,
          pickupCoords: { lat: pickupData.lat, lng: pickupData.lng },
          dropoffCoords: { lat: dropoffData.lat, lng: dropoffData.lng },
          isRated: ride.isRated,
          timestamp: Number(ride.timestamp) // 新增時間戳記
        });
      }
      setAllRides(rides);
    } catch (err) {
      console.error("讀取訂單失敗:", err);
    }
  };

  // --- 設置事件監聽 ---
  const setupEventListeners = (_contract, myAddress) => {
    const refresh = () => fetchRides(_contract);

    _contract.on("RideRequested", refresh);
    _contract.on("RideAccepted", refresh);
    _contract.on("RideStarted", refresh);
    _contract.on("RideCompleted", refresh);
    _contract.on("RideCancelled", refresh);
    _contract.on("DriverRated", refresh);
  };

  // --- 監聽訂單狀態變更 (更新 UI) ---
  useEffect(() => {
    if (!walletAddress || allRides.length === 0) return;

    const myRides = allRides.filter(r => 
      (r.passenger.toLowerCase() === walletAddress.toLowerCase() || 
       (r.driver && r.driver.toLowerCase() === walletAddress.toLowerCase()))
    );

    const activeRide = myRides.sort((a, b) => b.id - a.id)[0];
    
    // 如果正在查看歷史紀錄，不自動跳轉狀態，除非有新的進行中訂單
    if (appState === 'HISTORY' || appState === 'RATING') return;

    if (activeRide && ['Created', 'Accepted', 'Ongoing'].includes(activeRide.status)) {
      setMyCurrentRide(activeRide);
      
      if (activeRide.status === 'Created') {
        if (role === 'passenger') setAppState('WAITING_DRIVER');
      } else if (activeRide.status === 'Accepted') {
        setAppState('DRIVER_EN_ROUTE');
      } else if (activeRide.status === 'Ongoing') {
        setAppState('IN_TRIP');
      }
    } else if (activeRide && activeRide.status === 'Completed' && !activeRide.isRated && role === 'passenger') {
        setMyCurrentRide(activeRide);
        setAppState('RATING');
    } else if (activeRide && activeRide.status === 'Cancelled') {
        if (['WAITING_DRIVER', 'DRIVER_EN_ROUTE'].includes(appState)) {
             resetApp();
        }
    }
  }, [allRides, walletAddress, role]);

  // --- 核心邏輯：與智能合約交互 ---

  const handleRequestRide = async () => {
    if (!pickup || !dropoff || !contract) return;
    try {
      await switchNetwork();
      setLoading(true);
      setLoadingMsg('請在錢包中確認交易...');
      
      const pickupData = JSON.stringify({ name: pickup, lat: pickupCoords.lat, lng: pickupCoords.lng });
      const dropoffData = JSON.stringify({ name: dropoff, lat: dropoffCoords.lat, lng: dropoffCoords.lng });
      
      const currentSigner = await (new ethers.BrowserProvider(window.ethereum)).getSigner();
      const contractWithSigner = contract.connect(currentSigner);

      const tx = await contractWithSigner.requestRide(pickupData, dropoffData, {
        value: ethers.parseEther(estimatedPrice.toString())
      });
      
      setLoadingMsg('交易廣播中，等待區塊確認...');
      await tx.wait(); 
      
      setLoading(false);
      setAppState('WAITING_DRIVER');
    } catch (err) {
      console.error(err);
      if (err.code === "ACTION_REJECTED") {
         alert("您取消了交易");
      } else {
         alert("交易失敗: " + (err.reason || err.message));
      }
      setLoading(false);
    }
  };

  const handleAcceptRide = async (rideId) => {
    if (!contract) return;
    try {
      await switchNetwork();
      setLoading(true);
      setLoadingMsg('正在接單...');
      
      const currentSigner = await (new ethers.BrowserProvider(window.ethereum)).getSigner();
      const contractWithSigner = contract.connect(currentSigner);
      
      const tx = await contractWithSigner.acceptRide(rideId);
      await tx.wait();
      setLoading(false);
    } catch (err) {
      console.error(err);
      alert("接單失敗: " + (err.reason || err.message));
      setLoading(false);
    }
  };

  const handleStartRide = async () => {
    if (!contract || !myCurrentRide) return;
    try {
      await switchNetwork();
      setLoading(true);
      setLoadingMsg('更新行程狀態...');
      
      const currentSigner = await (new ethers.BrowserProvider(window.ethereum)).getSigner();
      const contractWithSigner = contract.connect(currentSigner);

      const tx = await contractWithSigner.startRide(myCurrentRide.id);
      await tx.wait();
      setLoading(false);
    } catch (err) {
      console.error(err);
      setLoading(false);
    }
  };

  const handleCompleteRide = async () => {
    if (!contract || !myCurrentRide) return;
    try {
      await switchNetwork();
      setLoading(true);
      setLoadingMsg('確認到達並釋放資金...');
      
      const currentSigner = await (new ethers.BrowserProvider(window.ethereum)).getSigner();
      const contractWithSigner = contract.connect(currentSigner);

      const tx = await contractWithSigner.completeRide(myCurrentRide.id);
      await tx.wait();
      setLoading(false);
      setAppState('RATING');
    } catch (err) {
      console.error(err);
      setLoading(false);
    }
  };

  // 修改：支援取消指定 ID 的訂單 (若未指定則取消當前)
  const handleCancelRide = async (rideId = null) => {
    const targetId = rideId || myCurrentRide?.id;
    if (!contract || !targetId) return;
    try {
      await switchNetwork();
      setLoading(true);
      setLoadingMsg('正在取消訂單並退款...');
      
      const currentSigner = await (new ethers.BrowserProvider(window.ethereum)).getSigner();
      const contractWithSigner = contract.connect(currentSigner);

      const tx = await contractWithSigner.cancelRide(targetId);
      await tx.wait();
      
      setLoading(false);
      alert("訂單已取消，資金已退回您的錢包。");
      
      // 如果是在歷史頁面取消，不重置整個 App，只需等待列表刷新
      if (appState !== 'HISTORY') {
        resetApp();
      }
    } catch (err) {
      console.error(err);
      alert("取消失敗: " + (err.reason || err.message));
      setLoading(false);
    }
  };

  const handleRateDriver = async (stars) => {
    if (!contract || !myCurrentRide) return;
    try {
      await switchNetwork();
      setLoading(true);
      setLoadingMsg('提交評價上鏈...');
      
      const currentSigner = await (new ethers.BrowserProvider(window.ethereum)).getSigner();
      const contractWithSigner = contract.connect(currentSigner);

      const tx = await contractWithSigner.rateDriver(myCurrentRide.id, stars);
      await tx.wait();
      
      alert(`評價成功！交易雜湊: ${tx.hash}`);
      resetApp();
    } catch (err) {
      console.error(err);
      resetApp();
    } finally {
      setLoading(false);
    }
  };

  const resetApp = () => {
    setAppState('IDLE');
    setPickup('');
    setDropoff('');
    setPickupCoords(null);
    setDropoffCoords(null);
    setMyCurrentRide(null);
    setEstimatedPrice(0.001);
  };

  const mockReverseGeocode = (lat, lng) => {
    const distToNTU = Math.sqrt(Math.pow(lat - 25.0174, 2) + Math.pow(lng - 121.5397, 2));
    if (distToNTU < 0.002) return "國立台灣大學圖書館";
    if (distToNTU < 0.005) return "公館捷運站";
    return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
  };

  const handleMapClick = (lat, lng) => {
    if (appState !== 'IDLE') return;
    const address = mockReverseGeocode(lat, lng);
    if (activeField === 'pickup' || !activeField) {
      setPickup(address);
      setPickupCoords({ lat, lng });
      if (!activeField) setActiveField('dropoff');
    } else if (activeField === 'dropoff') {
      setDropoff(address);
      setDropoffCoords({ lat, lng });
      setActiveField(null);
    }
  };

  // --- Leaflet Map Component ---
  const LeafletMap = ({ pickupCoords, dropoffCoords, currentRide, onMapClick }) => {
    const mapRef = useRef(null);
    const mapInstanceRef = useRef(null);
    const markersRef = useRef([]);
    const routingLineRef = useRef(null);
    const NTU_COORDS = [25.0174, 121.5397];

    useEffect(() => {
      if (!mapInstanceRef.current && mapRef.current) {
        const map = L.map(mapRef.current, {
          center: NTU_COORDS,
          zoom: 16,
          zoomControl: false, 
          attributionControl: false
        });
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);
        map.on('click', (e) => onMapClick(e.latlng.lat, e.latlng.lng));
        mapInstanceRef.current = map;
      }
    }, []);

    useEffect(() => {
      if (!mapInstanceRef.current) return;
      const map = mapInstanceRef.current;
      markersRef.current.forEach(marker => marker.remove());
      markersRef.current = [];
      if (routingLineRef.current) { routingLineRef.current.remove(); routingLineRef.current = null; }

      const createIcon = (color) => L.divIcon({
        className: 'custom-div-icon',
        html: `<div style="background-color: ${color}; width: 12px; height: 12px; border-radius: 50%; border: 2px solid white; box-shadow: 0 0 4px rgba(0,0,0,0.5);"></div>`,
        iconSize: [12, 12],
        iconAnchor: [6, 6]
      });

      const pCoords = currentRide?.pickupCoords || pickupCoords;
      const dCoords = currentRide?.dropoffCoords || dropoffCoords;

      if (pCoords) {
        const marker = L.marker([pCoords.lat, pCoords.lng], { icon: createIcon('black') }).addTo(map);
        markersRef.current.push(marker);
      }
      if (dCoords) {
        const marker = L.marker([dCoords.lat, dCoords.lng], { icon: createIcon('gray') }).addTo(map);
        markersRef.current.push(marker);
      }
      if (pCoords && dCoords) {
        const latlngs = [[pCoords.lat, pCoords.lng], [dCoords.lat, dCoords.lng]];
        const polyline = L.polyline(latlngs, { color: 'black', weight: 3, dashArray: '5, 10' }).addTo(map);
        routingLineRef.current = polyline;
        map.fitBounds(polyline.getBounds(), { padding: [50, 50] });
      } else if (pCoords) {
        map.panTo([pCoords.lat, pCoords.lng]);
      }

      if (currentRide && ['Accepted', 'Ongoing'].includes(currentRide.status) && pCoords) {
        const carIcon = L.divIcon({
          className: 'car-icon',
          html: `<div style="background: black; color: white; padding: 4px; border-radius: 4px; font-size: 10px; display: flex; align-items: center; justify-content: center;">BIKE</div>`,
          iconSize: [30, 20]
        });
        L.marker([pCoords.lat, pCoords.lng], { icon: carIcon, zIndexOffset: 1000 }).addTo(map);
      }
    }, [pickupCoords, dropoffCoords, currentRide]);
    return <div ref={mapRef} className="absolute inset-0 z-0" />;
  };

  // --- UI Components ---
  const Header = () => {
    // 處理左上角按鈕點擊
    const handleMenuClick = () => {
      if (appState === 'IDLE') {
        setAppState('HISTORY'); // 從首頁進入歷史頁
      } else if (appState === 'HISTORY') {
        setAppState('IDLE'); // 從歷史頁返回首頁
      } else {
        if (confirm('確定要取消並返回嗎？')) resetApp();
      }
    };

    return (
      <div className="absolute top-0 left-0 right-0 z-20 p-4 flex justify-between items-start pointer-events-none">
        <div className="pointer-events-auto">
          <button 
            onClick={handleMenuClick}
            className="bg-white p-3 rounded-full shadow-lg hover:bg-gray-100 transition relative"
          >
            {/* 根據狀態顯示不同圖標 */}
            {appState === 'IDLE' ? <Menu size={24} /> : <ChevronLeft size={24} />}
            
            {/* 如果在 IDLE 狀態顯示提示紅點 (如果有進行中訂單) - 可選 */}
          </button>
        </div>
        <div className="pointer-events-auto bg-white/90 backdrop-blur rounded-full p-1 shadow-lg flex space-x-1">
          <button onClick={() => setRole('passenger')} className={`px-4 py-2 rounded-full text-sm font-bold transition ${role === 'passenger' ? 'bg-black text-white' : 'text-gray-500 hover:bg-gray-100'}`}>乘客</button>
          <button onClick={() => setRole('driver')} className={`px-4 py-2 rounded-full text-sm font-bold transition ${role === 'driver' ? 'bg-black text-white' : 'text-gray-500 hover:bg-gray-100'}`}>司機</button>
        </div>
        <div className="pointer-events-auto flex flex-col items-end space-y-2">
          <div className="bg-white/90 backdrop-blur px-4 py-2 rounded-full shadow-lg flex items-center space-x-2">
            <Wallet size={16} className="text-green-600" />
            <span className="font-mono font-bold">{balance} ETH</span>
          </div>
          <div className="bg-black text-white px-3 py-1 rounded-full text-xs opacity-75 truncate max-w-[100px]">
            {walletAddress ? `${walletAddress.substring(0, 6)}...${walletAddress.substring(38)}` : '未連接'}
          </div>
        </div>
      </div>
    );
  };

  const LoadingOverlay = () => (
    <div className="absolute inset-0 bg-black/50 z-50 flex flex-col items-center justify-center text-white backdrop-blur-sm">
      <Loader2 className="animate-spin mb-4" size={48} />
      <p className="font-bold text-lg">{loadingMsg || '區塊鏈確認中...'}</p>
      <p className="text-sm opacity-80 mt-2">請勿關閉瀏覽器</p>
    </div>
  );

  // 新增：歷史行程視圖
  const renderHistoryView = () => {
    // 過濾出與我相關的行程
    const myHistory = allRides.filter(r => 
      r.passenger.toLowerCase() === walletAddress.toLowerCase() || 
      (r.driver && r.driver.toLowerCase() === walletAddress.toLowerCase())
    ).sort((a, b) => b.id - a.id); // 降序排列

    return (
      <div className="absolute bottom-0 left-0 right-0 bg-white rounded-t-3xl shadow-2xl z-20 p-6 pointer-events-auto h-3/4 flex flex-col">
        <div className="flex justify-between items-center mb-4 flex-shrink-0">
          <div>
            <h2 className="text-2xl font-bold flex items-center"><History className="mr-2"/> 我的行程</h2>
            <span className="text-xs text-gray-400">Sepolia Chain History</span>
          </div>
          <button onClick={() => setAppState('IDLE')} className="p-2 bg-gray-100 rounded-full hover:bg-gray-200"><XCircle size={20}/></button>
        </div>

        <div className="flex-grow overflow-y-auto space-y-4 pb-4">
          {myHistory.length === 0 ? (
            <div className="text-center py-12 text-gray-400"><p>尚無行程紀錄</p></div>
          ) : (
            myHistory.map((ride) => (
              <div key={ride.id} className="border border-gray-100 bg-gray-50 p-4 rounded-xl shadow-sm relative">
                <div className="flex justify-between items-start mb-2">
                  <div className="flex items-center space-x-2">
                    <span className="font-bold text-gray-800">#{ride.id}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-bold ${
                      ride.status === 'Completed' ? 'bg-green-100 text-green-700' :
                      ride.status === 'Cancelled' ? 'bg-red-100 text-red-700' :
                      ride.status === 'Created' ? 'bg-yellow-100 text-yellow-700' :
                      'bg-blue-100 text-blue-700'
                    }`}>{ride.status}</span>
                  </div>
                  <span className="font-mono text-sm">{ride.amount} ETH</span>
                </div>
                
                <div className="space-y-1 text-sm text-gray-600 mb-3">
                  <div className="flex items-center"><MapPin size={12} className="mr-1"/> {ride.pickup}</div>
                  <div className="flex items-center"><Navigation size={12} className="mr-1"/> {ride.dropoff}</div>
                  {ride.timestamp > 0 && (
                    <div className="flex items-center text-xs text-gray-400 mt-1">
                      <Clock size={10} className="mr-1"/> {new Date(ride.timestamp * 1000).toLocaleString()}
                    </div>
                  )}
                </div>

                {/* 只有在 Created 或 Accepted 狀態下，乘客可以取消 */}
                {['Created', 'Accepted'].includes(ride.status) && ride.passenger.toLowerCase() === walletAddress.toLowerCase() && (
                  <button 
                    onClick={() => handleCancelRide(ride.id)} 
                    disabled={loading}
                    className="w-full mt-2 bg-white border border-red-200 text-red-600 py-2 rounded-lg text-sm font-bold hover:bg-red-50 flex items-center justify-center"
                  >
                    <XCircle size={14} className="mr-1"/> 取消行程 (退款)
                  </button>
                )}
                
                {/* 如果已完成且未評價 */}
                {ride.status === 'Completed' && !ride.isRated && ride.passenger.toLowerCase() === walletAddress.toLowerCase() && (
                  <button 
                    onClick={() => { setMyCurrentRide(ride); setAppState('RATING'); }} 
                    className="w-full mt-2 bg-black text-white py-2 rounded-lg text-sm font-bold hover:opacity-90"
                  >
                    前往評價
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    );
  };

  const renderPassengerView = () => {
    // 優先處理 HISTORY 狀態
    if (appState === 'HISTORY') {
      return renderHistoryView();
    }

    if (appState === 'IDLE') {
      return (
        <div className="absolute bottom-0 left-0 right-0 bg-white rounded-t-3xl shadow-[0_-5px_20px_rgba(0,0,0,0.1)] z-20 p-6 animate-slide-up pointer-events-auto">
          <h2 className="text-2xl font-bold mb-4">想去哪裡？</h2>
          <p className="text-xs text-gray-500 mb-4 flex items-center">
            <Crosshair size={12} className="mr-1"/> 點擊輸入框後在地圖上選點
          </p>
          <div className="space-y-4 mb-6">
            <div className="relative">
              <div className={`absolute left-4 top-3.5 w-2 h-2 rounded-full transition-colors ${activeField === 'pickup' ? 'bg-blue-500 scale-125' : 'bg-black'}`}></div>
              <div className="absolute left-5 top-6 w-0.5 h-8 bg-gray-300"></div>
              <input type="text" placeholder="輸入上車地點" value={pickup} onFocus={() => setActiveField('pickup')} onChange={(e) => setPickup(e.target.value)} className="w-full bg-gray-100 p-3 pl-10 rounded-lg focus:outline-none border-2 font-medium transition-colors border-transparent focus:border-black focus:bg-white" />
            </div>
            <div className="relative">
              <div className={`absolute left-4 top-3.5 w-2 h-2 transition-colors ${activeField === 'dropoff' ? 'bg-blue-500 scale-125' : 'bg-black'}`}></div>
              <input type="text" placeholder="輸入目的地" value={dropoff} onFocus={() => setActiveField('dropoff')} onChange={(e) => setDropoff(e.target.value)} className="w-full bg-gray-100 p-3 pl-10 rounded-lg focus:outline-none border-2 font-medium transition-colors border-transparent focus:border-black focus:bg-white" />
            </div>
          </div>
          {pickup && dropoff && (
            <div className="space-y-3 mb-6">
              <div onClick={() => { setSelectedRideType('NTUber Bike'); setEstimatedPrice(0.001); }} className={`flex justify-between items-center p-3 rounded-xl border-2 cursor-pointer transition ${selectedRideType === 'NTUber Bike' ? 'border-black bg-gray-50' : 'border-transparent hover:bg-gray-50'}`}>
                <div className="flex items-center space-x-3">
                  <div className="bg-gray-200 p-2 rounded-full"><Bike size={24} className="text-gray-700" /></div>
                  <div><div className="font-bold text-lg">NTUber Bike</div><div className="text-xs text-gray-500">環保出行</div></div>
                </div>
                <div className="font-bold text-lg">{estimatedPrice} ETH</div>
              </div>
            </div>
          )}
          <button onClick={handleRequestRide} disabled={!pickup || !dropoff || loading} className="w-full bg-black text-white py-4 rounded-xl font-bold text-lg shadow-lg hover:scale-[1.01] transition-transform disabled:opacity-50 disabled:cursor-not-allowed">
            {loading ? '處理中...' : '確認叫車 (Sepolia ETH)'}
          </button>
        </div>
      );
    }

    if (appState === 'WAITING_DRIVER') {
      return (
        <div className="absolute bottom-0 left-0 right-0 bg-white rounded-t-3xl shadow-2xl z-20 p-6 text-center pointer-events-auto">
          <div className="animate-pulse mb-4 flex justify-center"><div className="bg-gray-100 p-4 rounded-full"><Navigation size={48} className="text-black animate-spin-slow" /></div></div>
          <h3 className="text-xl font-bold mb-2">訂單已上鏈！</h3>
          <p className="text-gray-500 mb-6">正在等待區塊鏈上的司機接單...</p>
          <div className="w-full bg-gray-200 h-1.5 rounded-full overflow-hidden mb-6"><div className="bg-black h-full w-2/3 animate-indeterminate"></div></div>
          {/* 更新：改為真實取消按鈕 */}
          <button onClick={() => handleCancelRide(null)} disabled={loading} className="text-red-500 font-bold underline hover:text-red-700 flex items-center justify-center mx-auto">
             <XCircle size={16} className="mr-1"/> 取消叫車並退款
          </button>
        </div>
      );
    }
    if (appState === 'DRIVER_EN_ROUTE' || appState === 'IN_TRIP') return renderActiveRideView();
    if (appState === 'RATING') return renderRatingView();
  };

  const renderDriverView = () => {
    // 司機也可以查看歷史
    if (appState === 'HISTORY') return renderHistoryView();

    if (myCurrentRide && ['Accepted', 'Ongoing'].includes(myCurrentRide.status)) return renderActiveRideView();
    return (
      <div className="absolute bottom-0 left-0 right-0 bg-white rounded-t-3xl shadow-2xl z-20 p-6 pointer-events-auto h-2/3 flex flex-col">
        <div className="flex justify-between items-center mb-4 flex-shrink-0">
          <div><h2 className="text-2xl font-bold flex items-center"><List className="mr-2"/> 鏈上訂單列表</h2><span className="text-xs text-gray-400">Sepolia Testnet Live Feed</span></div>
          <div className="flex items-center space-x-2 bg-black text-white px-3 py-1 rounded-full text-sm"><div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div><span>上線中</span></div>
        </div>
        <div className="flex-grow overflow-y-auto space-y-4 pb-4">
          {allRides.filter(r => r.status === 'Created').length === 0 ? (
            <div className="text-center py-12 text-gray-400"><p>目前鏈上沒有待處理訂單</p></div>
          ) : (
            allRides.filter(r => r.status === 'Created').map((ride) => (
              <div key={ride.id} className="border-2 border-gray-100 bg-white p-4 rounded-xl shadow-sm hover:border-black transition relative">
                <div className="flex justify-between items-start mb-3">
                  <div className="flex items-center space-x-2"><div className="bg-gray-100 p-1.5 rounded-full"><User size={14}/></div><span className="font-bold text-gray-600">ID: #{ride.id}</span></div>
                  <span className="font-bold text-xl text-green-600">{ride.amount} ETH</span>
                </div>
                <div className="space-y-3 text-sm text-gray-700 mb-4">
                  <div className="flex items-start space-x-2"><div className="w-2 h-2 bg-black rounded-full mt-1.5 flex-shrink-0"></div><span className="break-words">{ride.pickup}</span></div>
                  <div className="flex items-start space-x-2"><div className="w-2 h-2 bg-black opacity-30 mt-1.5 flex-shrink-0"></div><span className="break-words">{ride.dropoff}</span></div>
                </div>
                <button onClick={() => handleAcceptRide(ride.id)} disabled={loading} className="w-full bg-black text-white py-3 rounded-lg font-bold shadow hover:opacity-90 disabled:opacity-50">{loading ? '處理中...' : '接單 (Gas)'}</button>
              </div>
            ))
          )}
        </div>
      </div>
    );
  };

  const renderActiveRideView = () => {
    const isDriver = role === 'driver';
    const title = appState === 'DRIVER_EN_ROUTE' ? (isDriver ? '前往接送乘客' : '司機正在前往您的位置') : '行程進行中';
    
    // 是否可以取消：只有在 DRIVER_EN_ROUTE 狀態下，且為乘客或司機（合約允許雙方取消）
    const canCancel = appState === 'DRIVER_EN_ROUTE';

    return (
      <div className="absolute bottom-0 left-0 right-0 bg-white rounded-t-3xl shadow-2xl z-20 p-0 overflow-hidden pointer-events-auto">
        <div className="bg-black text-white p-4 text-center font-bold flex justify-between items-center relative">
          <div className="w-full text-center">{title}</div>
          {/* 在標題列右側加入取消按鈕（如果允許的話） */}
          {canCancel && (
            <button 
              onClick={() => handleCancelRide(null)} 
              disabled={loading}
              className="absolute right-4 text-xs bg-red-600 px-2 py-1 rounded hover:bg-red-700 transition"
            >
              取消
            </button>
          )}
        </div>
        <div className="p-6">
          <div className="flex justify-between items-center mb-6 border-b border-gray-100 pb-6">
            <div className="flex items-center space-x-4">
              <div className="w-16 h-16 bg-gray-200 rounded-full flex items-center justify-center overflow-hidden border-2 border-white shadow"><User size={32} className="text-gray-500" /></div>
              <div>
                <h3 className="font-bold text-xl">{isDriver ? '乘客' : '司機'}</h3>
                <div className="flex items-center space-x-1 text-gray-500 text-sm"><Star size={14} fill="currentColor" className="text-yellow-500" /><span>4.9</span></div>
                <div className="text-xs text-gray-400 mt-1">ID #{myCurrentRide?.id}</div>
              </div>
            </div>
          </div>
          {isDriver ? (
             appState === 'DRIVER_EN_ROUTE' ? (
                <button onClick={handleStartRide} disabled={loading} className="w-full bg-black text-white py-4 rounded-xl font-bold text-lg shadow-lg hover:scale-[1.01] transition">確認接到乘客 (上鏈)</button>
             ) : (<div className="w-full bg-green-50 border border-green-200 text-green-800 py-4 rounded-xl font-bold text-lg text-center">行程進行中...</div>)
          ) : (
             appState === 'IN_TRIP' ? (
               <button onClick={handleCompleteRide} disabled={loading} className="w-full bg-green-600 text-white py-4 rounded-xl font-bold text-lg shadow-lg hover:bg-green-700 transition">{loading ? '確認中...' : '確認到達並釋放資金 (ETH)'}</button>
             ) : (<button disabled className="w-full bg-gray-100 text-gray-400 py-4 rounded-xl font-bold text-lg cursor-not-allowed">等待司機到達...</button>)
          )}
        </div>
      </div>
    );
  };

  const renderRatingView = () => (
    <div className="absolute inset-0 bg-white z-50 flex flex-col items-center justify-center p-8 animate-fade-in pointer-events-auto">
      <div className="w-24 h-24 bg-green-100 rounded-full flex items-center justify-center mb-6 text-green-600"><ShieldCheck size={48} /></div>
      <h2 className="text-3xl font-bold mb-2">行程完成！</h2>
      <p className="text-gray-500 mb-8 text-center">資金已透過智能合約轉移。<br/>請為本次行程評分。</p>
      <div className="flex space-x-4 mb-10">{[1, 2, 3, 4, 5].map(star => (<button key={star} onClick={() => handleRateDriver(star)} className="transform hover:scale-110 transition"><Star size={40} className="text-yellow-400 hover:fill-current" /></button>))}</div>
      <button onClick={() => { resetApp(); }} className="text-gray-400 underline">跳過評分</button>
    </div>
  );

  return (
    <div className="font-sans text-gray-900 bg-gray-100 h-screen w-full relative overflow-hidden flex flex-col">
      <LeafletMap pickupCoords={pickupCoords} dropoffCoords={dropoffCoords} currentRide={myCurrentRide} onMapClick={handleMapClick} />
      {loading && <LoadingOverlay />}
      <Header />
      <div className="relative z-10 flex-grow pointer-events-none">
         {role === 'passenger' ? renderPassengerView() : renderDriverView()}
      </div>
    </div>
  );
};

export default NTUberApp;
