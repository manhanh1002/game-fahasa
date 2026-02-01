const express = require('express');
require('dotenv').config();
const cors = require('cors');
const axios = require('axios');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
// Serve static files from the public directory (for local development)
app.use(express.static(path.join(__dirname, '../public')));

// ===== HEALTH CHECK =====
app.get('/health', (req, res) => {
    res.status(200).send('OK');
});

// ===== CONFIG =====
const NOCODB_API_URL = 'https://nocodb.smax.in/api/v2/tables/mkuczx2ud6zitcr/records';
const NOCODB_TOKEN = process.env.NOCODB_TOKEN;

if (!NOCODB_TOKEN) {
    console.warn("WARNING: NOCODB_TOKEN is missing from environment variables.");
}

// ===== CHECK CONDITION =====
app.get('/api/check', async (req, res) => {
    const { code } = req.query;
    if (!code) return res.status(400).json({ error: 'Missing random_code' });
    
    // Sanitize code to prevent injection (Alphanumeric only)
    if (!/^[a-zA-Z0-9]+$/.test(code)) {
        return res.status(400).json({ error: 'Invalid code format' });
    }

    if (!NOCODB_TOKEN) return res.status(500).json({ error: 'Server misconfiguration: Missing Token' });

    try {
        const whereClause = `(random_code,eq,${code})`;
        const response = await axios.get(NOCODB_API_URL, {
            headers: { 'xc-token': NOCODB_TOKEN },
            params: { where: whereClause, limit: 1 }
        });

        const record = response.data.list?.[0];
        if (!record) return res.json({ valid: false });

        res.json({
            valid: true,
            status: record.status,
            prize: record.prize,
            prize_id: record.prize_id // Return prize_id
        });

    } catch (err) {
        console.error(err.message);
        res.status(500).json({ error: 'Server error' });
    }
});
// ===== UPDATE STATUS & PLAY GAME =====
// ===== PRIZE CONFIGURATION =====
// Adjust limits via Environment Variables on Railway
// Defaults are set to Production values
const PRIZE_LIMITS = {
    'prize-2': parseInt(process.env.PRIZE_LIMIT_2 || '0'),      // Máy tính
    'prize-3': parseInt(process.env.PRIZE_LIMIT_3 || '2'),   // 5k Fpoint
    'prize-4': parseInt(process.env.PRIZE_LIMIT_4 || '0'),     // 200k Fpoint
    'prize-5': parseInt(process.env.PRIZE_LIMIT_5 || '0')     // 10k Fpoint
};

const PRIZE_NAMES = {
    'prize-2': 'Máy tính Casio FX580',
    'prize-3': '5.000 F-point',
    'prize-4': '200.000 F-point',
    'prize-5': '10.000 F-point'
};

// Prize Cache
let prizeCache = {
    data: null,
    lastFetch: 0,
    TTL: 15000 // 15 seconds
};

// In-memory Lock for Concurrency Control (Single Instance)
const processingCodes = new Set();

// GLOBAL MUTEX for Prize Allocation (Prevent Race Condition between users)
// Simple Promise-based Queue to serialize critical section
let prizeAllocationMutex = Promise.resolve();

function withPrizeLock(task) {
    const result = prizeAllocationMutex.then(() => task());
    // Catch errors so the queue doesn't stall, but we let the caller handle the error via the returned promise
    prizeAllocationMutex = result.catch(() => {});
    return result;
}

// Helper: Retry Operation with Exponential Backoff
async function retryOperation(operation, retries = 3, delay = 500) {
    for (let i = 0; i < retries; i++) {
        try {
            return await operation();
        } catch (err) {
            if (i === retries - 1) throw err;
            const waitTime = delay * Math.pow(1.5, i); // Exponential backoff
            console.warn(`Operation failed, retrying in ${waitTime}ms... (${i + 1}/${retries})`);
            await new Promise(res => setTimeout(res, waitTime));
        }
    }
}

// Helper: Get Current Prize Counts from NocoDB
async function getPrizeCounts() {
    // Return cached data if valid
    if (prizeCache.data && (Date.now() - prizeCache.lastFetch < prizeCache.TTL)) {
        return prizeCache.data;
    }

    const counts = {};
    const promises = Object.keys(PRIZE_LIMITS).map(async (prizeId) => {
        try {
            const whereClause = `(prize_id,eq,${prizeId})`;
            // Use Retry for Count to avoid false positives (0 count due to error)
            await retryOperation(async () => {
                const res = await axios.get(NOCODB_API_URL, {
                    headers: { 'xc-token': NOCODB_TOKEN },
                    params: {
                        where: whereClause,
                        limit: 1 // We only need the count metadata
                    },
                    timeout: 5000 // 5s timeout
                });
                // NocoDB V2 usually returns { list: [], pageInfo: { totalRows: 10 } }
                counts[prizeId] = res.data.pageInfo?.totalRows ?? 0;
            }, 3, 300);
        } catch (e) {
            console.error(`Error counting ${prizeId}:`, e.message);
            // CRITICAL: If we can't count, we MUST NOT assume 0. 
            // We should throw to abort the allocation.
            throw new Error(`Failed to count ${prizeId}`);
        }
    });
    
    await Promise.all(promises);

    // Update Cache
    prizeCache.data = counts;
    prizeCache.lastFetch = Date.now();

    return counts;
}

// Helper: Pick a Random Prize based on weights (remaining quantity)
function pickRandomPrize(currentCounts) {
    const availablePrizes = [];

    // Calculate remaining quantity for each prize
    for (const [id, limit] of Object.entries(PRIZE_LIMITS)) {
        const used = currentCounts[id] || 0;
        const remaining = Math.max(0, limit - used);

        if (remaining > 0) {
            availablePrizes.push({ id, weight: remaining });
        }
    }

    if (availablePrizes.length === 0) {
        return null; // Out of stock
    }

    // Weighted Random Selection
    const totalWeight = availablePrizes.reduce((sum, p) => sum + p.weight, 0);
    let random = Math.random() * totalWeight;

    for (const prize of availablePrizes) {
        if (random < prize.weight) {
            return prize.id;
        }
        random -= prize.weight;
    }

    return availablePrizes[availablePrizes.length - 1].id; // Fallback
}

app.post('/api/update', async (req, res) => {
    const { code, status } = req.body;
    // NOTE: We ignore 'prize' and 'prize_id' from client when status is PLAYER
    // because Server now decides the prize.

    if (!NOCODB_TOKEN) return res.status(500).json({ error: 'Server misconfiguration: Missing Token' });

    if (!code) {
        return res.status(400).json({ error: 'Missing code' });
    }

    // Sanitize code to prevent injection
    if (!/^[a-zA-Z0-9]+$/.test(code)) {
        return res.status(400).json({ error: 'Invalid code format' });
    }

    // CONCURRENCY LOCK: Prevent same code from being processed multiple times simultaneously
    if (processingCodes.has(code)) {
        return res.status(429).json({ error: 'Request is being processed. Please wait.' });
    }
    
    // Acquire Lock
    processingCodes.add(code);

    const targetStatus = status || 'PLAYER';

    try {
        // 1. Find the Record
        const whereClause = `(random_code,eq,${code})`;
        const findRes = await axios.get(NOCODB_API_URL, {
            headers: { 'xc-token': NOCODB_TOKEN },
            params: { where: whereClause, limit: 1 }
        });

        const record = findRes.data.list?.[0];
        if (!record) {
            return res.status(404).json({ error: 'Record not found' });
        }

        // 2. Cheat Protection Logic
        if (targetStatus === 'OPENNING') {
            // Allow OPENNING -> OPENNING (Idempotency / Multi-tab support)
            if (record.status === 'OPENNING') {
                 return res.json({ success: true, status: 'OPENNING' });
            }

            if (record.status !== 'INVITED') {
                // Idempotency: If already OPENNING (same session), assume retry? 
                // But typically client handles that. Server blocks strictly.
                // Unless it's the SAME device re-sending? 
                // For safety: strict block.
                const response = { error: 'Start blocked', currentStatus: record.status };
                if (record.status === 'PLAYER') {
                    response.prize = record.prize;
                    response.prize_id = record.prize_id;
                }
                return res.status(409).json(response);
            }
            // Just update status to OPENNING
            try {
                await axios.patch(NOCODB_API_URL, { Id: record.Id, status: 'OPENNING' }, { headers: { 'xc-token': NOCODB_TOKEN } });
                return res.json({ success: true, status: 'OPENNING' });
            } catch (patchError) {
                console.error("NocoDB Patch Error:", patchError.response?.data || patchError.message);
                return res.status(500).json({ error: 'Database update failed' });
            }
        }

        if (targetStatus === 'PLAYER') {
            // If already played, return the existing prize (Don't roll again)
            if (record.status === 'PLAYER') {
                return res.json({
                    success: true,
                    status: 'PLAYER',
                    prize: record.prize,
                    prize_id: record.prize_id,
                    is_existing: true // Flag to tell client this is an old prize
                });
            }

            // Ensure valid transition (must lie in OPENNING or INVITED)
            if (record.status !== 'INVITED' && record.status !== 'OPENNING') {
                return res.status(409).json({ error: 'Check blocked', currentStatus: record.status });
            }

            // ANTI-DDOS / CONCURRENCY MITIGATION
            // Add a small random delay (100ms - 500ms) to desynchronize simultaneous requests
            // This reduces the chance of 1000 requests hitting the DB check at the exact same millisecond
            await new Promise(resolve => setTimeout(resolve, Math.floor(Math.random() * 400) + 100));

            // 3. LOTTERY LOGIC (Server Side) - WRAPPED IN GLOBAL MUTEX
            // Critical Section: Read Count -> Check Limit -> Update DB
            // Only ONE request can execute this block at a time.
            const allocationResult = await withPrizeLock(async () => {
                // Double check status inside lock in case it changed while waiting
                // (Optional but good practice if we were re-fetching record, 
                // but here we rely on the fact that THIS code is locked by processingCodes per user,
                // so we just need to protect the PRIZE COUNTS).
                
                // CRITICAL FIX: Do NOT invalidate cache here. 
                // We rely on the in-memory cache being updated sequentially by previous users in this Lock.
                // Fetching from DB again risks reading stale data due to DB consistency lag.
                // prizeCache.lastFetch = 0; <--- REMOVED
                
                const currentCounts = await getPrizeCounts();
                const winningPrizeId = pickRandomPrize(currentCounts);

                if (!winningPrizeId) {
                    return { success: false, error: 'OUT_OF_STOCK' };
                }

                const winningPrizeName = PRIZE_NAMES[winningPrizeId];

                // 4. Update NocoDB (The Commit)
                try {
                     await axios.patch(
                        NOCODB_API_URL,
                        {
                            Id: record.Id,
                            status: 'PLAYER',
                            prize: winningPrizeName,
                            prize_id: winningPrizeId,
                            // Add timestamp to help identify who came last (though NocoDB has UpdatedAt, explicit is safer)
                            won_at: new Date().toISOString() 
                        },
                        { headers: { 'xc-token': NOCODB_TOKEN } }
                    );
                } catch (dbError) {
                    console.error("DB Update Failed inside Lock:", dbError);
                    return { success: false, error: 'DB_ERROR' };
                }

                // 5. POST-COMMIT VERIFICATION (The "Safety Net" for Distributed Systems)
                // Check if we oversold due to race conditions across multiple server instances
                try {
                    const verifyLimit = PRIZE_LIMITS[winningPrizeId];
                    // Only check if limit is small/critical
                    if (verifyLimit > 0) {
                        const verifyWhere = `(prize_id,eq,${winningPrizeId})`;
                        
                        // CRITICAL FIX: Rank-based Verification
                        // Instead of voiding everyone if Count > Limit, we sort winners by time and keep the first N.
                        let winners = [];
                        let winnerCount = 0;
                        
                        await retryOperation(async () => {
                            const verifyRes = await axios.get(NOCODB_API_URL, {
                                headers: { 'xc-token': NOCODB_TOKEN },
                                params: { 
                                    where: verifyWhere, 
                                    limit: verifyLimit + 10, // Fetch enough to find ourselves
                                    sort: 'updated_at,Id' // Sort by Time ASC, then ID ASC (stable sort)
                                },
                                timeout: 5000
                            });
                            winners = verifyRes.data.list || [];
                            winnerCount = verifyRes.data.pageInfo?.totalRows || winners.length;
                        }, 3, 300);

                        if (winnerCount > verifyLimit) {
                            console.warn(`OVERSOLD DETECTED for ${winningPrizeId}. Limit: ${verifyLimit}, Actual: ${winnerCount}. Checking Rank...`);
                            
                            // Find my position in the list
                            const myIndex = winners.findIndex(w => w.Id === record.Id);
                            
                            if (myIndex === -1) {
                                // I am not even in the list? Something is wrong, or pagination missed me.
                                // Safer to void to be conservative, or assume I am late.
                                console.warn(`User ${code} not found in winner list (Top ${verifyLimit+10}). Voiding.`);
                                // Proceed to Re-allocation/Void logic below
                            } else if (myIndex < verifyLimit) {
                                // I am within the limit! (Index 0 to limit-1)
                                // I should STAY. Do NOT void.
                                console.log(`User ${code} is Rank ${myIndex + 1}/${winnerCount}. Safe (Limit ${verifyLimit}). Keeping prize.`);
                                // Update Cache and Return Success
                                if (prizeCache.data) {
                                    prizeCache.data[winningPrizeId] = (prizeCache.data[winningPrizeId] || 0) + 1;
                                    prizeCache.lastFetch = Date.now();
                                }
                                return { 
                                    success: true, 
                                    data: {
                                        status: 'PLAYER',
                                        prize: winningPrizeName,
                                        prize_id: winningPrizeId
                                    }
                                };
                            } else {
                                console.warn(`User ${code} is Rank ${myIndex + 1}/${winnerCount}. Late! (Limit ${verifyLimit}). Initiating Re-allocation.`);
                                // Fall through to the existing Re-allocation logic
                            }
                            
                            // Only proceed to re-allocation if we are the ones who need to leave
                            
                            // STRATEGY: Dynamic Re-allocation
                            // 1. Force Refresh Cache to get latest DB state
                            prizeCache.lastFetch = 0;
                            const freshCounts = await getPrizeCounts();
                            
                            // 2. Check stock of OTHER prizes
                            const fallbackPrizeId = pickRandomPrize(freshCounts);
                            
                            if (fallbackPrizeId) {
                                const fallbackPrizeName = PRIZE_NAMES[fallbackPrizeId];
                                console.log(`Re-allocating ${code} from ${winningPrizeId} to ${fallbackPrizeName}`);
                                
                                // Update DB to the new prize
                                await axios.patch(
                                    NOCODB_API_URL,
                                    {
                                        Id: record.Id,
                                        status: 'PLAYER',
                                        prize: fallbackPrizeName,
                                        prize_id: fallbackPrizeId,
                                        note: 'Re-allocated due to oversell'
                                    },
                                    { headers: { 'xc-token': NOCODB_TOKEN } }
                                );

                                // DOUBLE VERIFICATION: Check if the NEW prize is also oversold?
                                // (Race condition could happen exactly during re-allocation)
                                try {
                                    const fallbackLimit = PRIZE_LIMITS[fallbackPrizeId];
                                    if (fallbackLimit > 0) {
                                        let fallbackCount = 0;
                                        await retryOperation(async () => {
                                            const verifyFallbackRes = await axios.get(NOCODB_API_URL, {
                                                headers: { 'xc-token': NOCODB_TOKEN },
                                                params: { 
                                                    where: `(prize_id,eq,${fallbackPrizeId})`, 
                                                    limit: fallbackLimit + 5 
                                                },
                                                timeout: 5000
                                            });
                                            fallbackCount = verifyFallbackRes.data.pageInfo?.totalRows ?? 0;
                                        }, 3, 500);
                                        
                                        if (fallbackCount > fallbackLimit) {
                                            console.warn(`Double Oversell detected! ${code} failed re-allocation to ${fallbackPrizeId}. Voiding.`);
                                            throw new Error('REALLOCATION_OVERSOLD');
                                        }
                                    }
                                } catch (doubleVerifyErr) {
                                    // If verification fails or shows oversell, we MUST Void to be safe
                                    await axios.patch(
                                        NOCODB_API_URL,
                                        {
                                            Id: record.Id,
                                            status: 'OPENNING',
                                            prize: null,
                                            prize_id: null,
                                            note: 'Voided: Double Oversell'
                                        },
                                        { headers: { 'xc-token': NOCODB_TOKEN } }
                                    );
                                    return { success: false, error: 'OUT_OF_STOCK' };
                                }
                                
                                // Update Cache for the NEW prize so next user sees correct count
                                if (prizeCache.data) {
                                    prizeCache.data[fallbackPrizeId] = (prizeCache.data[fallbackPrizeId] || 0) + 1;
                                }
                                
                                return { 
                                    success: true, 
                                    data: {
                                        status: 'PLAYER',
                                        prize: fallbackPrizeName,
                                        prize_id: fallbackPrizeId
                                    }
                                };
                            } else {
                                // 3. If ALL prizes are OOS, Void the transaction
                                console.warn(`All prizes OOS during re-allocation for ${code}. Voiding.`);
                                await axios.patch(
                                    NOCODB_API_URL,
                                    {
                                        Id: record.Id,
                                        status: 'OPENNING',
                                        prize: null,
                                        prize_id: null,
                                        note: 'Voided: Out of Stock'
                                    },
                                    { headers: { 'xc-token': NOCODB_TOKEN } }
                                );
                                return { success: false, error: 'OUT_OF_STOCK' };
                            }
                        }
                    }
                } catch (verifyError) {
                    console.error("Verification failed:", verifyError);
                    
                    // CRITICAL FIX: FAIL SAFE
                    // If verification fails (e.g. DB timeout), we CANNOT assume success.
                    // We must attempt to VOID the prize to prevent overselling during outages.
                    try {
                        console.warn(`Attempting to VOID prize for ${code} due to Verification Failure...`);
                        await axios.patch(
                            NOCODB_API_URL,
                            {
                                Id: record.Id,
                                status: 'OPENNING',
                                prize: null,
                                prize_id: null,
                                note: 'Voided: Verification Failed (System Error)'
                            },
                            { headers: { 'xc-token': NOCODB_TOKEN } }
                        );
                        return { success: false, error: 'SYSTEM_BUSY' };
                    } catch (voidErr) {
                         console.error("CRITICAL: VOID FAILED for user " + code, voidErr.message);
                         // If we can't even void, we are in trouble. 
                         // But we should still return error to client so they don't think they won.
                         return { success: false, error: 'SYSTEM_ERROR' };
                    }
                }
                
                // Update Cache Immediately inside lock to reflect new state for next person
                // This ensures the next person in the queue sees the incremented count instantly
                if (winningPrizeId && prizeCache.data) {
                    prizeCache.data[winningPrizeId] = (prizeCache.data[winningPrizeId] || 0) + 1;
                    // Extend TTL to keep this fresh data valid for the next burst of requests
                    prizeCache.lastFetch = Date.now(); 
                }

                return { 
                    success: true, 
                    data: {
                        status: 'PLAYER',
                        prize: winningPrizeName,
                        prize_id: winningPrizeId
                    }
                };
            });

            if (!allocationResult.success) {
                if (allocationResult.error === 'OUT_OF_STOCK') {
                     return res.status(422).json({ error: 'All prizes are out of stock!' });
                }
                return res.status(500).json({ error: 'Transaction failed' });
            }

            const resultData = allocationResult.data;
            console.log(`User ${code} won ${resultData.prize_id} (${resultData.prize})`);

            return res.json({
                success: true,
                status: 'PLAYER',
                prize: resultData.prize,
                prize_id: resultData.prize_id
            });
        }

    } catch (err) {
        console.error(err.response?.data || err.message);
        res.status(500).json({ error: 'Update failed' });
    } finally {
        // Release Lock
        processingCodes.delete(code);
    }
});

if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
    });
}

module.exports = app;