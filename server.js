/**
 * 🔱 APEX v38.9.25 - THE TRIANGULAR WHALE TITAN
 * Strategy: Whale-Triggered Cyclic Arbitrage (WETH -> USDC -> cbETH -> WETH)
 * Logic: Borrow millions via Flash Loan to exploit tiny "Long-Tail" inefficiencies.
 */

const { ethers, Wallet, WebSocketProvider } = require('ethers');

const CONFIG = {
    CHAIN_ID: 8453,
    TARGET_CONTRACT: "0x83EF5c401fAa5B9674BAfAcFb089b30bAc67C9A0",
    WSS_URL: "wss://base-mainnet.g.alchemy.com/v2/G-WBAMA8JxJMjkc-BCeoK",
    
    // --- THE TRIANGLE NODES ---
    WETH: "0x4200000000000000000000000000000000000006",
    USDC: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    CBETH: "0x2Ae3F1Ec7F1F5563a3d161649c025dac7e983970", // Long-tail "Inefficiency" target

    WHALE_MIN_ETH: ethers.parseEther("5"), // Trigger on smaller moves for Long-Tail tokens
    MARGIN_ETH: "0.008", // Target ~$25 net profit after all fees
    GAS_LIMIT: 1200000n, // Higher gas for 3-hop logic
};

async function startTriangularStriker() {
    console.log(`\n🔱 APEX TRIANGULAR: SEARCHING FOR JACKPOTS...`);
    const provider = new WebSocketProvider(CONFIG.WSS_URL);
    const signer = new Wallet(process.env.TREASURY_PRIVATE_KEY, provider);

    // 1. DYNAMIC FLASH LOAN SCALE (Borrow based on wallet tier)
    async function getFlashLoanAmount() {
        const balance = await provider.getBalance(signer.address);
        const eth = parseFloat(ethers.formatEther(balance));
        if (eth > 0.1) return ethers.parseEther("100"); // Borrow ~330k
        if (eth > 0.05) return ethers.parseEther("50");  // Borrow ~165k
        return ethers.parseEther("20");                 // Borrow ~66k
    }

    // 2. WHALE LISTENER (Multi-Token Monitoring)
    const swapTopic = ethers.id("Swap(address,uint256,uint256,uint256,uint256,address)");
    
    provider.on({ topics: [swapTopic] }, async (log) => {
        try {
            // Check if swap involves our Long-Tail asset (cbETH) or USDC
            const isTarget = log.topics.some(t => 
                t.toLowerCase().includes(CONFIG.CBETH.toLowerCase().slice(2)) ||
                t.toLowerCase().includes(CONFIG.USDC.toLowerCase().slice(2))
            );
            if (!isTarget) return;

            const loanSize = await getFlashLoanAmount();
            
            // 3. DEFINE TRIANGULAR PATHS (Clockwise & Counter-Clockwise)
            const paths = [
                [CONFIG.WETH, CONFIG.USDC, CONFIG.CBETH, CONFIG.WETH],
                [CONFIG.WETH, CONFIG.CBETH, CONFIG.USDC, CONFIG.WETH]
            ];

            // 4. ATOMIC SIMULATION (Verify profit before spending gas)
            for (const path of paths) {
                const iface = new ethers.Interface(["function executeTriangle(address[],uint256)"]);
                const strikeData = iface.encodeFunctionData("executeTriangle", [path, loanSize]);

                const simulation = await provider.call({
                    to: CONFIG.TARGET_CONTRACT,
                    data: strikeData,
                    from: signer.address
                });

                const rawProfit = BigInt(simulation);
                const feeData = await provider.getFeeData();
                const gasCost = CONFIG.GAS_LIMIT * (feeData.maxFeePerGas || feeData.gasPrice);
                const aaveFee = (loanSize * 9n) / 10000n; // 0.09% Aave Fee
                
                const netProfit = rawProfit - (gasCost + aaveFee);

                if (netProfit > ethers.parseEther(CONFIG.MARGIN_ETH)) {
                    console.log(`\n🎯 JACKPOT FOUND! Net: ${ethers.formatEther(netProfit)} ETH`);
                    
                    const tx = await signer.sendTransaction({
                        to: CONFIG.TARGET_CONTRACT,
                        data: strikeData,
                        gasLimit: CONFIG.GAS_LIMIT,
                        maxPriorityFeePerGas: feeData.maxPriorityFeePerGas,
                        maxFeePerGas: feeData.maxFeePerGas,
                        type: 2
                    });
                    console.log(`🚀 STRIKE FIRED: ${tx.hash}`);
                    await tx.wait();
                    break; 
                }
            }
        } catch (e) { /* Simulation failed - no gap found */ }
    });

    provider.websocket.on("close", () => setTimeout(startTriangularStriker, 5000));
}

startTriangularStriker().catch(console.error);
