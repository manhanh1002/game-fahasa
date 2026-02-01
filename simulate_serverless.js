const axios = require('axios');

// MOCK CONSTANTS
const PRIZE_LIMITS = {
    'prize-2': 0, 
    'prize-3': 1, // Target Prize (Limit 1)
    'prize-4': 0,
    'prize-5': 0
};
const PRIZE_NAMES = {
    'prize-2': 'Prize 2',
    'prize-3': 'Prize 3',
    'prize-4': 'Prize 4',
    'prize-5': 'Prize 5'
};

// MOCK DATABASE (In-Memory)
const db = {
    records: [],
    // Latency simulation
    async query(method, params) {
        await new Promise(r => setTimeout(r, Math.random() * 50)); // Random 0-50ms latency
        
        if (method === 'GET') {
            const { where } = params;
            // Parse where clause (simple regex for (prize_id,eq,X))
            const prizeMatch = where.match(/\(prize_id,eq,([a-z0-9-]+)\)/);
            if (prizeMatch) {
                const pid = prizeMatch[1];
                const count = this.records.filter(r => r.prize_id === pid).length;
                return { data: { pageInfo: { totalRows: count }, list: this.records.filter(r => r.prize_id === pid) } };
            }
            // Code match
            const codeMatch = where.match(/\(random_code,eq,([A-Z0-9]+)\)/);
            if (codeMatch) {
                 const code = codeMatch[1];
                 const rec = this.records.find(r => r.random_code === code);
                 return { data: { list: rec ? [rec] : [] } };
            }
        }
        if (method === 'PATCH') {
            const { Id, prize_id, prize } = params;
            const rec = this.records.find(r => r.Id === Id);
            if (rec) {
                rec.prize_id = prize_id;
                rec.prize = prize;
                rec.status = prize_id ? 'PLAYER' : 'OPENNING';
                rec.updated_at = new Date().toISOString();
            }
            return { data: rec };
        }
    }
};

// SEED DB with Test Codes
['ABC21', 'ABC22', 'ABC23', 'ABC24', 'ABC25', 'ABC110'].forEach((code, i) => {
    db.records.push({
        Id: i + 1,
        random_code: code,
        status: 'INVITED',
        prize: null,
        prize_id: null
    });
});

// SIMULATED SERVER FUNCTION (No Global Mutex)
async function playGame(code) {
    // 1. Find Record
    const findRes = await db.query('GET', { where: `(random_code,eq,${code})` });
    const record = findRes.data.list[0];
    
    // 2. Prize Allocation (Simulating logic in index.js)
    // Fetch Counts (Uncached for this test to be strict, or simulated cache)
    // In index.js we use getPrizeCounts.
    const counts = {};
    for(let pid in PRIZE_LIMITS) {
        const res = await db.query('GET', { where: `(prize_id,eq,${pid})` });
        counts[pid] = res.data.pageInfo.totalRows;
    }
    
    // Pick Random
    const available = [];
    for(let pid in PRIZE_LIMITS) {
        if (counts[pid] < PRIZE_LIMITS[pid]) available.push(pid);
    }
    
    if (available.length === 0) return { error: 'OUT_OF_STOCK' };
    
    // Force pick prize-3 for testing collision
    const winningPrizeId = 'prize-3'; 
    if (!available.includes(winningPrizeId)) return { error: 'OUT_OF_STOCK' };

    // 3. Update DB
    await db.query('PATCH', { Id: record.Id, prize_id: winningPrizeId, prize: PRIZE_NAMES[winningPrizeId] });
    
    // 4. Verify
    const verifyLimit = PRIZE_LIMITS[winningPrizeId];
    const verifyRes = await db.query('GET', { where: `(prize_id,eq,${winningPrizeId})` });
    const winnerCount = verifyRes.data.pageInfo.totalRows;
    
    if (winnerCount > verifyLimit) {
        console.log(`OVERSOLD DETECTED for ${code}! Count: ${winnerCount}`);
        
        // Re-allocation Logic (SIMPLIFIED)
        // Try to switch to prize-5 (limit 0) -> Should fail
        // Try to switch to prize-2 (limit 0) -> Should fail
        // Void.
        
        // Double Verify Logic Simulation
        // In real code, we check other prizes. Here all are 0 except prize-3.
        // So re-allocation should fail and Void.
        
        await db.query('PATCH', { Id: record.Id, prize_id: null, prize: null }); // Void
        return { error: 'VOIDED_DUE_TO_OVERSOLD' };
    }
    
    return { success: true, prize: winningPrizeId };
}

// RUN CONCURRENT ATTACK
async function runAttack() {
    console.log("Starting Attack with 3 codes (ABC24, ABC25, ABC110)...");
    const codes = ['ABC24', 'ABC25', 'ABC110'];
    
    // Reset DB for this run (mock)
    db.records.forEach(r => {
        if (codes.includes(r.random_code)) {
            r.status = 'INVITED';
            r.prize = null;
            r.prize_id = null;
        }
    });

    const results = await Promise.all(codes.map(code => playGame(code)));
    
    console.log("Results:", results);
    console.log("Final DB State for Prize 3:");
    const finalRes = await db.query('GET', { where: `(prize_id,eq,prize-3)` });
    console.log("Total Winners:", finalRes.data.pageInfo.totalRows);
}

runAttack();
