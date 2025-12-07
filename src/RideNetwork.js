/**
 * RideNetwork - 模擬 P2P 網路/區塊鏈層
 * 這是一個單例 (Singleton) 物件，用於在乘客與司機組件之間共享狀態。
 * 在真實的 DApp 中，這會被 Smart Contract 或 IPFS 替代。
 */
class RideNetwork {
  constructor() {
    this.rides = []; // 儲存所有訂單 (模擬區塊鏈帳本)
    this.listeners = []; // 訂閱者 (React Components)
    this.rideCounter = 100;
  }

  // --- 訂閱機制 (Observer Pattern) ---
  subscribe(callback) {
    this.listeners.push(callback);
    // 訂閱時立即回傳當前狀態
    callback([...this.rides]);
    
    // 回傳取消訂閱函數
    return () => {
      this.listeners = this.listeners.filter(cb => cb !== callback);
    };
  }

  notify() {
    this.listeners.forEach(cb => cb([...this.rides]));
  }

  // --- 核心操作 ---

  // 1. 乘客發布訂單 (Broadcast)
  createRide(rideData) {
    const newRide = {
      ...rideData,
      id: this.rideCounter++,
      status: 'Created',
      timestamp: Date.now()
    };
    this.rides.push(newRide);
    this.notify();
    return newRide;
  }

  // 2. 司機接單 (Accept)
  acceptRide(rideId, driverAddress) {
    const rideIndex = this.rides.findIndex(r => r.id === rideId);
    if (rideIndex > -1 && this.rides[rideIndex].status === 'Created') {
      this.rides[rideIndex] = {
        ...this.rides[rideIndex],
        status: 'Accepted',
        driver: driverAddress
      };
      this.notify();
      return this.rides[rideIndex];
    }
    return null;
  }

  // 3. 更新狀態 (開始行程/完成行程/取消)
  updateRideStatus(rideId, newStatus) {
    const rideIndex = this.rides.findIndex(r => r.id === rideId);
    if (rideIndex > -1) {
      this.rides[rideIndex] = {
        ...this.rides[rideIndex],
        status: newStatus
      };
      this.notify();
    }
  }

  // 取得特定使用者的當前活躍訂單
  getActiveRideForUser(address) {
    return this.rides.find(r => 
      (r.passenger === address || r.driver === address) && 
      ['Created', 'Accepted', 'Ongoing'].includes(r.status)
    );
  }
}

// 匯出單例實例
export const rideNetwork = new RideNetwork();
