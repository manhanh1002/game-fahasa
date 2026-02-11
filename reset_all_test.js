require('dotenv').config();
const axios = require('axios');

const NOCODB_API_URL = 'https://nocodb.smax.in/api/v2/tables/mkuczx2ud6zitcr/records';
const NOCODB_TOKEN = process.env.NOCODB_TOKEN;

const CODES = ['ABC21', 'ABC22', 'ABC23', 'ABC24', 'ABC25', 'ABC26', 'ABC27'];

async function reset() {
    console.log('Resetting ABC21-ABC27...');
    
    for (const code of CODES) {
        // 1. Find ID
        const findRes = await axios.get(NOCODB_API_URL, {
            headers: { 'xc-token': NOCODB_TOKEN },
            params: { where: `(random_code,eq,${code})` }
        });

        if (findRes.data.list.length > 0) {
            const id = findRes.data.list[0].Id;
            // 2. Update to INVITED
            await axios.patch(NOCODB_API_URL, {
                Id: id,
                status: 'INVITED',
                prize: null,
                prize_id: null,
                note: null,
                lock_status: null
            }, {
                headers: { 'xc-token': NOCODB_TOKEN }
            });
            console.log(`Reset ${code} (ID: ${id})`);
            
            // Verify read
            const verifyRes = await axios.get(NOCODB_API_URL, {
                headers: { 'xc-token': NOCODB_TOKEN },
                params: { where: `(Id,eq,${id})`, limit: 1 }
            });
            console.log(`[VERIFY] ${code} LockStatus:`, verifyRes.data.list[0].lock_status);
        }
    }
    console.log('Reset Complete.');
}

reset();
