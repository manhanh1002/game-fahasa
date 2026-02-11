// 10-MINUTE TIMEOUT LOGIC
        // If status is OPENNING, check if it has been more than 10 minutes since first access (UpdatedAt)
        if (record.status === 'OPENNING') {
            const lastUpdated = new Date(record.UpdatedAt).getTime();
            const now = Date.now();
            if (now - lastUpdated > 10 * 60 * 1000) { // 10 minutes
                console.warn(`User ${code} has EXPIRED (10min timeout).`);
                // Optional: Update status to EXPIRED in DB for persistence
                try {
                    await axios.patch(NOCODB_API_URL, { Id: record.Id, status: 'EXPIRED' }, { headers: { 'xc-token': NOCODB_TOKEN } });
                } catch (e) {
                    console.error("Failed to update EXPIRED status:", e.message);
                }
                return res.json({
                    valid: true,
                    status: 'EXPIRED',
                    prize: null
                });
            }
        }

        // If status is INVITED, it means first access. 
        // Update to OPENNING immediately to start the 10-minute timer.
        if (record.status === 'INVITED') {
            try {
                await axios.patch(NOCODB_API_URL, { Id: record.Id, status: 'OPENNING' }, { headers: { 'xc-token': NOCODB_TOKEN } });
                // We return OPENNING to the client so it knows the timer has started
                return res.json({
                    valid: true,
                    status: 'OPENNING',
                    prize: null
                });
            } catch (e) {
                console.error("Failed to initialize OPENNING status:", e.message);
                // Fallback to INVITED if update fails, it will try again next check
            }
        }
