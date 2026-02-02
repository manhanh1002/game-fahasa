require('dotenv').config();
const axios = require('axios');

const NOCODB_API_URL = 'https://nocodb.smax.in/api/v2/tables/mkuczx2ud6zitcr/records';
const NOCODB_TOKEN = process.env.NOCODB_TOKEN;

const CODES = ['ABC21', 'ABC22', 'ABC23', 'ABC24', 'ABC25', 'ABC26', 'ABC27'];

async function verify() {
    console.log('🔍 Verifying Zombie States...');
    let zombieCount = 0;
    
    for (const code of CODES) {
        try {
            const findRes = await axios.get(NOCODB_API_URL, {
                headers: { 'xc-token': NOCODB_TOKEN },
                params: { where: `(random_code,eq,${code})`, limit: 1 }
            });
            
            const record = findRes.data.list?.[0];
            if (!record) {
                console.log(`[${code}] Not Found`);
                continue;
            }

            const isZombie = record.status === 'PLAYER' && !record.prize;
            const statusStr = isZombie ? '❌ ZOMBIE' : '✅ OK';
            
            console.log(`[${code}] Status: ${record.status}, Prize: ${record.prize}, Lock: ${record.lock_status} -> ${statusStr}`);
            
            if (isZombie) zombieCount++;

        } catch (err) {
            console.error(`[${code}] Error:`, err.message);
        }
    }
    
    if (zombieCount > 0) {
        console.error(`\n⚠️ FOUND ${zombieCount} ZOMBIE RECORDS!`);
        process.exit(1);
    } else {
        console.log('\n✅ NO ZOMBIE RECORDS FOUND.');
        process.exit(0);
    }
}

verify();
