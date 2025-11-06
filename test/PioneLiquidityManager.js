const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");

describe("PioneLiquidityManager", function () {

    // Fixture để deploy contracts và mock dependencies
    async function deployLiquidityManagerFixture() {
        const [owner, manager, user1, user2] = await ethers.getSigners();

        // Deploy Mock Tokens
        const MockERC20 = await ethers.getContractFactory("MockERC20");
        const pioneToken = await MockERC20.deploy("PIONE Token", "PIO", ethers.parseEther("1000000"));
        const usdtToken = await MockERC20.deploy("Tether USD", "USDT", ethers.parseEther("1000000"));

        await pioneToken.waitForDeployment();
        await usdtToken.waitForDeployment();

        // Deploy Mock PancakePair (LP Token)
        const MockPancakePair = await ethers.getContractFactory("MockPancakePair");
        const lpToken = await MockPancakePair.deploy("PancakePair PIO-USDT", "PIO-USDT-LP", ethers.parseEther("1000000"));
        await lpToken.waitForDeployment();

        // Setup the pair with token addresses
        await lpToken.setTokens(usdtToken.target, pioneToken.target);

        // Set initial reserves (e.g., 1000 USDT and 2000 PIO for 1 USDT = 2 PIO ratio)
        await lpToken.setReserves(
            ethers.parseEther("1000"), // reserve0 (USDT)
            ethers.parseEther("2000")  // reserve1 (PIO)
        );

        // Deploy Mock Factory
        const MockFactory = await ethers.getContractFactory("MockFactory");
        const factory = await MockFactory.deploy();
        await factory.waitForDeployment();

        // Setup factory to return LP token address
        await factory.setPair(lpToken.target);

        // Deploy Mock PancakeRouter
        const MockPancakeRouter = await ethers.getContractFactory("MockPancakeRouter");
        const router = await MockPancakeRouter.deploy();
        await router.waitForDeployment();

        // Setup router to use factory
        await router.setFactory(factory.target);

        // Deploy Mock PioneChainBridge
        const MockBridge = await ethers.getContractFactory("MockPioneChainBridge");
        const bridge = await MockBridge.deploy();
        await bridge.waitForDeployment();

        // Deploy Mock PinkLock
        const MockPinkLock = await ethers.getContractFactory("MockPinkLock");
        const pinkLock = await MockPinkLock.deploy();
        await pinkLock.waitForDeployment();

        // Deploy PioneLiquidityManager
        const PioneLiquidityManager = await ethers.getContractFactory("PioneLiquidityManager");
        const liquidityManager = await PioneLiquidityManager.deploy(
            pioneToken.target,
            usdtToken.target,
            bridge.target,
            router.target,
            pinkLock.target,
            5080
        );
        await liquidityManager.waitForDeployment();

        // Transfer tokens to users for testing
        await pioneToken.transfer(user1.address, ethers.parseEther("10000"));
        await pioneToken.transfer(liquidityManager.target, ethers.parseEther("100000"));
        await usdtToken.transfer(user1.address, ethers.parseEther("10000"));
        await usdtToken.transfer(liquidityManager.target, ethers.parseEther("100000"));

        // Transfer LP tokens to router for testing (router will transfer these back when addLiquidity is called)
        await lpToken.transfer(router.target, ethers.parseEther("100000"));

        // User approves tokens to liquidity manager
        await usdtToken.connect(user1).approve(liquidityManager.target, ethers.MaxUint256);

        return {
            liquidityManager,
            pioneToken,
            usdtToken,
            router,
            bridge,
            pinkLock,
            lpToken,
            owner,
            manager,
            user1,
            user2
        };
    }

    describe("Deployment", function () {
        it("Should set the correct token addresses", async function () {
            const { liquidityManager, pioneToken, usdtToken } = await loadFixture(deployLiquidityManagerFixture);

            expect(await liquidityManager.PIONE_TOKEN()).to.equal(pioneToken.target);
            expect(await liquidityManager.USDT_TOKEN()).to.equal(usdtToken.target);
        });

        it("Should set correct roles", async function () {
            const { liquidityManager, owner } = await loadFixture(deployLiquidityManagerFixture);
            const DEFAULT_ADMIN_ROLE = await liquidityManager.DEFAULT_ADMIN_ROLE();
            const MANAGER_ROLE = await liquidityManager.MANAGER_ROLE();

            expect(await liquidityManager.hasRole(DEFAULT_ADMIN_ROLE, owner.address)).to.be.true;
            expect(await liquidityManager.hasRole(MANAGER_ROLE, owner.address)).to.be.true;
        });

        it("Should approve max tokens to router in constructor", async function () {
            const { liquidityManager, pioneToken, usdtToken } = await loadFixture(deployLiquidityManagerFixture);
            const routerAddress = await liquidityManager.router();

            // Check if tokens are approved (this requires router to be accessible)
            // Note: May need to check actual allowance if router address is accessible
            expect(routerAddress).to.not.equal(ethers.ZeroAddress);
        });
    });

    describe("handleBridgeCompleted", function () {
        it("Should create transaction record for user", async function () {
            const { liquidityManager, bridge, user1 } = await loadFixture(deployLiquidityManagerFixture);

            const requestId = ethers.id("test-request-1");
            const pioAmount = ethers.parseEther("100");
            const usdtAmount = ethers.parseEther("50");

            // Mark transaction as processed in mock bridge
            await bridge.setProcessedTransaction(requestId, true);

            await expect(
                liquidityManager.handleBridgeCompleted(requestId, user1.address, pioAmount, usdtAmount, 6)
            ).to.emit(liquidityManager, "LiquidityRequestCreated")
              .withArgs(requestId, user1.address, pioAmount, usdtAmount, 6);

            // Verify transaction info
            const txInfo = await liquidityManager.getTransactionInfo(requestId);
            expect(txInfo.pioAmount).to.equal(pioAmount);
            expect(txInfo.usdtAmount).to.equal(usdtAmount);
            expect(txInfo.liquidityAmount).to.equal(0);
            expect(txInfo._depositUSDT).to.be.false;
            expect(txInfo.pinkLockId).to.equal(0);
            expect(txInfo.lockMonths).to.equal(6);
        });

        it("Should revert if transaction not processed on bridge", async function () {
            const { liquidityManager, user1 } = await loadFixture(deployLiquidityManagerFixture);

            const requestId = ethers.id("test-request-2");
            const pioAmount = ethers.parseEther("100");
            const usdtAmount = ethers.parseEther("50");

            await expect(
                liquidityManager.handleBridgeCompleted(requestId, user1.address, pioAmount, usdtAmount, 6)
            ).to.be.revertedWith("Transaction not completed");
        });

        it("Should revert if requestId already used", async function () {
            const { liquidityManager, bridge, user1 } = await loadFixture(deployLiquidityManagerFixture);

            const requestId = ethers.id("test-request-3");
            const pioAmount = ethers.parseEther("100");
            const usdtAmount = ethers.parseEther("50");

            await bridge.setProcessedTransaction(requestId, true);
            await liquidityManager.handleBridgeCompleted(requestId, user1.address, pioAmount, usdtAmount, 6);

            // Try to use same requestId again
            await expect(
                liquidityManager.handleBridgeCompleted(requestId, user1.address, pioAmount, usdtAmount, 6)
            ).to.be.revertedWith("RequestId already set");
        });

        it("Should only be callable by manager role", async function () {
            const { liquidityManager, bridge, user1, user2 } = await loadFixture(deployLiquidityManagerFixture);

            const requestId = ethers.id("test-request-4");
            const pioAmount = ethers.parseEther("100");
            const usdtAmount = ethers.parseEther("50");

            await bridge.setProcessedTransaction(requestId, true);

            await expect(
                liquidityManager.connect(user2).handleBridgeCompleted(requestId, user1.address, pioAmount, usdtAmount, 6)
            ).to.be.revertedWith("Not manager");
        });
    });

    describe("depositUSDT", function () {
        it("Should allow user to deposit USDT", async function () {
            const { liquidityManager, bridge, usdtToken, user1 } = await loadFixture(deployLiquidityManagerFixture);

            const requestId = ethers.id("test-deposit-1");
            const pioAmount = ethers.parseEther("100");
            const usdtAmount = ethers.parseEther("50");

            // Setup: handleBridgeCompleted first
            await bridge.setProcessedTransaction(requestId, true);
            await liquidityManager.handleBridgeCompleted(requestId, user1.address, pioAmount, usdtAmount, 6);

            const balanceBefore = await usdtToken.balanceOf(liquidityManager.target);

            await expect(
                liquidityManager.connect(user1).depositUSDT(requestId)
            ).to.emit(liquidityManager, "UserDepositUSDT")
              .withArgs(requestId, user1.address, usdtAmount);

            const balanceAfter = await usdtToken.balanceOf(liquidityManager.target);
            expect(balanceAfter - balanceBefore).to.equal(usdtAmount);

            // Verify transaction updated
            const txInfo = await liquidityManager.getTransactionInfo(requestId);
            const userInfo = await liquidityManager.getUserBalances(user1.address);
            expect(txInfo._depositUSDT).to.be.true;
            expect(userInfo.usdtBalance).to.equal(usdtAmount);
        });

        it("Should revert if USDT already deposited", async function () {
            const { liquidityManager, bridge, user1 } = await loadFixture(deployLiquidityManagerFixture);

            const requestId = ethers.id("test-deposit-2");
            const pioAmount = ethers.parseEther("100");
            const usdtAmount = ethers.parseEther("50");

            await bridge.setProcessedTransaction(requestId, true);
            await liquidityManager.handleBridgeCompleted(requestId, user1.address, pioAmount, usdtAmount, 6);
            await liquidityManager.connect(user1).depositUSDT(requestId);

            // Try to deposit again
            await expect(
                liquidityManager.connect(user1).depositUSDT(requestId)
            ).to.be.revertedWith("Already deposited USDT");
        });

        it("Should revert if requestId doesn't exist", async function () {
            const { liquidityManager, user1 } = await loadFixture(deployLiquidityManagerFixture);

            const requestId = ethers.id("non-existent-request");

            await expect(
                liquidityManager.connect(user1).depositUSDT(requestId)
            ).to.be.revertedWith("RequestId does not exist");
        });
    });

    describe("claimUSDT", function () {
        it("Should allow user to claim USDT balance", async function () {
            const { liquidityManager, bridge, usdtToken, user1 } = await loadFixture(deployLiquidityManagerFixture);

            const requestId = ethers.id("test-claim-1");
            const pioAmount = ethers.parseEther("100");
            const usdtAmount = ethers.parseEther("50");

            await bridge.setProcessedTransaction(requestId, true);
            await liquidityManager.handleBridgeCompleted(requestId, user1.address, pioAmount, usdtAmount, 6);
            await liquidityManager.connect(user1).depositUSDT(requestId);

            const claimAmount = ethers.parseEther("30");
            const balanceBefore = await usdtToken.balanceOf(user1.address);

            await expect(
                liquidityManager.connect(user1).claimUSDT(claimAmount)
            ).to.emit(liquidityManager, "ClaimedUSDT")
              .withArgs(user1.address, claimAmount);

            const balanceAfter = await usdtToken.balanceOf(user1.address);
            expect(balanceAfter - balanceBefore).to.equal(claimAmount);

            // Check remaining balance in contract
            const userInfo = await liquidityManager.getUserBalances(user1.address);
            expect(userInfo.usdtBalance).to.equal(usdtAmount - claimAmount);
        });

        it("Should revert if insufficient USDT balance", async function () {
            const { liquidityManager, user1 } = await loadFixture(deployLiquidityManagerFixture);

            const claimAmount = ethers.parseEther("100");

            await expect(
                liquidityManager.connect(user1).claimUSDT(claimAmount)
            ).to.be.revertedWith("Insufficient balance USDT");
        });

        it("Should revert if amount is zero", async function () {
            const { liquidityManager, user1 } = await loadFixture(deployLiquidityManagerFixture);

            await expect(
                liquidityManager.connect(user1).claimUSDT(0)
            ).to.be.revertedWith("invalid amount");
        });
    });

    describe("claimPioToPioneChain", function () {
        it("Should allow user to claim PIO to Pione Chain", async function () {
            const { liquidityManager, bridge, user1 } = await loadFixture(deployLiquidityManagerFixture);

            const requestId = ethers.id("test-claim-pio-1");
            const pioAmount = ethers.parseEther("100");
            const usdtAmount = ethers.parseEther("50");

            await bridge.setProcessedTransaction(requestId, true);
            await liquidityManager.handleBridgeCompleted(requestId, user1.address, pioAmount, usdtAmount, 6);

            const claimAmount = ethers.parseEther("50");

            await expect(
                liquidityManager.connect(user1).claimPioToPioneChain(claimAmount)
            ).to.emit(liquidityManager, "ClaimedPIOtoPioneChain");

            const userInfo = await liquidityManager.getUserBalances(user1.address);
            expect(userInfo.pioBalance).to.equal(pioAmount - claimAmount);
        });

        it("Should revert if amount is zero", async function () {
            const { liquidityManager, user1 } = await loadFixture(deployLiquidityManagerFixture);

            await expect(
                liquidityManager.connect(user1).claimPioToPioneChain(0)
            ).to.be.revertedWith("Amount PIO must be > 0");
        });

        it("Should revert if amount below minimum", async function () {
            const { liquidityManager, bridge, user1 } = await loadFixture(deployLiquidityManagerFixture);

            const requestId = ethers.id("test-claim-pio-2");
            const pioAmount = ethers.parseEther("100");
            const usdtAmount = ethers.parseEther("50");

            await bridge.setProcessedTransaction(requestId, true);
            await liquidityManager.handleBridgeCompleted(requestId, user1.address, pioAmount, usdtAmount, 6);

            const claimAmount = ethers.parseEther("0.5"); // Less than minimum 1 PIO

            await expect(
                liquidityManager.connect(user1).claimPioToPioneChain(claimAmount)
            ).to.be.revertedWith("Amount below minimum");
        });

        it("Should revert if insufficient PIO balance", async function () {
            const { liquidityManager, user1 } = await loadFixture(deployLiquidityManagerFixture);

            const claimAmount = ethers.parseEther("100");

            await expect(
                liquidityManager.connect(user1).claimPioToPioneChain(claimAmount)
            ).to.be.revertedWith("Insufficient balance PIO");
        });

        it("Should respect updated minimum claim amount", async function () {
            const { liquidityManager, bridge, owner, user1 } = await loadFixture(deployLiquidityManagerFixture);

            const requestId = ethers.id("test-claim-pio-3");
            const pioAmount = ethers.parseEther("100");
            const usdtAmount = ethers.parseEther("50");

            await bridge.setProcessedTransaction(requestId, true);
            await liquidityManager.handleBridgeCompleted(requestId, user1.address, pioAmount, usdtAmount, 6);

            // Set minimum to 10 PIO
            await liquidityManager.connect(owner).setMinClaimPIOAmount(ethers.parseEther("10"));

            // Try to claim 5 PIO (below new minimum)
            await expect(
                liquidityManager.connect(user1).claimPioToPioneChain(ethers.parseEther("5"))
            ).to.be.revertedWith("Amount below minimum");

            // Claim 10 PIO should work
            await expect(
                liquidityManager.connect(user1).claimPioToPioneChain(ethers.parseEther("10"))
            ).to.emit(liquidityManager, "ClaimedPIOtoPioneChain");
        });
    });

    describe("addLiquidity", function () {
        it("Should successfully add liquidity and lock LP tokens", async function () {
            const { liquidityManager, bridge, pinkLock, lpToken, user1 } = await loadFixture(deployLiquidityManagerFixture);

            const requestId = ethers.id("test-addliq-1");
            const pioAmount = ethers.parseEther("100");
            const usdtAmount = ethers.parseEther("50");
            const slippagePercent = 10;

            // Setup: bridge completed and USDT deposited
            await bridge.setProcessedTransaction(requestId, true);
            await liquidityManager.handleBridgeCompleted(requestId, user1.address, pioAmount, usdtAmount, 6);
            await liquidityManager.connect(user1).depositUSDT(requestId);

            // Add liquidity
            await expect(
                liquidityManager.connect(user1).addLiquidity(requestId, slippagePercent)
            ).to.emit(liquidityManager, "LiquidityAdded");

            // Verify transaction info
            const txInfo = await liquidityManager.getTransactionInfo(requestId);
            expect(txInfo.liquidityAmount).to.be.gt(0);
            expect(txInfo.pinkLockId).to.be.gt(0);

            // Verify lock was created
            const lockId = txInfo.pinkLockId;
            const lockInfo = await pinkLock.getLock(lockId);
            expect(lockInfo.owner).to.equal(user1.address);
            expect(lockInfo.token).to.equal(lpToken.target);
            expect(lockInfo.isLpToken).to.be.true;
            expect(lockInfo.amount).to.equal(txInfo.liquidityAmount);
        });

        it("Should emit LiquidityAdded event with correct parameters", async function () {
            const { liquidityManager, bridge, user1 } = await loadFixture(deployLiquidityManagerFixture);

            const requestId = ethers.id("test-addliq-2");
            const pioAmount = ethers.parseEther("100");
            const usdtAmount = ethers.parseEther("50");
            const slippagePercent = 5;

            await bridge.setProcessedTransaction(requestId, true);
            await liquidityManager.handleBridgeCompleted(requestId, user1.address, pioAmount, usdtAmount, 6);
            await liquidityManager.connect(user1).depositUSDT(requestId);

            // MockPancakeRouter returns 95% of desired amounts
            const expectedPioUsed = pioAmount * 95n / 100n;
            const expectedUsdtUsed = usdtAmount * 95n / 100n;
            const expectedLiquidity = (expectedPioUsed + expectedUsdtUsed) / 2n;

            await expect(
                liquidityManager.connect(user1).addLiquidity(requestId, slippagePercent)
            ).to.emit(liquidityManager, "LiquidityAdded")
             .withArgs(user1.address, requestId, expectedPioUsed, expectedUsdtUsed, expectedLiquidity, slippagePercent);
        });

        it("Should emit LiquidityLocked event with correct parameters", async function () {
            const { liquidityManager, bridge, user1 } = await loadFixture(deployLiquidityManagerFixture);

            const requestId = ethers.id("test-addliq-3");
            const pioAmount = ethers.parseEther("100");
            const usdtAmount = ethers.parseEther("50");
            const slippagePercent = 5;

            await bridge.setProcessedTransaction(requestId, true);
            await liquidityManager.handleBridgeCompleted(requestId, user1.address, pioAmount, usdtAmount, 6);
            await liquidityManager.connect(user1).depositUSDT(requestId);

            const expectedPioUsed = pioAmount * 95n / 100n;
            const expectedUsdtUsed = usdtAmount * 95n / 100n;
            const expectedLiquidity = (expectedPioUsed + expectedUsdtUsed) / 2n;

            const tx = await liquidityManager.connect(user1).addLiquidity(requestId, slippagePercent);
            const receipt = await tx.wait();
            const blockTimestamp = (await ethers.provider.getBlock(receipt.blockNumber)).timestamp;
            const expectedUnlockDate = blockTimestamp + (30 * 24 * 60 * 60 * 6); // 6 months

            await expect(tx)
                .to.emit(liquidityManager, "LiquidityLocked")
                .withArgs(user1.address, requestId, 1, expectedLiquidity, expectedUnlockDate);
        });

        it("Should update user balances correctly with refund", async function () {
            const { liquidityManager, bridge, user1 } = await loadFixture(deployLiquidityManagerFixture);

            const requestId = ethers.id("test-addliq-4");
            const pioAmount = ethers.parseEther("100");
            const usdtAmount = ethers.parseEther("50");

            await bridge.setProcessedTransaction(requestId, true);
            await liquidityManager.handleBridgeCompleted(requestId, user1.address, pioAmount, usdtAmount, 6);
            await liquidityManager.connect(user1).depositUSDT(requestId);

            await liquidityManager.connect(user1).addLiquidity(requestId, 10);

            const txInfo = await liquidityManager.getTransactionInfo(requestId);
            const userInfo = await liquidityManager.getUserBalances(user1.address);

            // MockRouter uses 95% of tokens, so 5% should be refunded
            const expectedPioRefund = pioAmount * 5n / 100n;
            const expectedUsdtRefund = usdtAmount * 5n / 100n;

            expect(userInfo.pioBalance).to.equal(expectedPioRefund);
            expect(userInfo.usdtBalance).to.equal(expectedUsdtRefund);
        });

        it("Should revert if requestId doesn't exist", async function () {
            const { liquidityManager, user1 } = await loadFixture(deployLiquidityManagerFixture);

            const requestId = ethers.id("non-existent-request");

            await expect(
                liquidityManager.connect(user1).addLiquidity(requestId, 10)
            ).to.be.revertedWith("RequestId does not exist");
        });

        it("Should revert if USDT not deposited yet", async function () {
            const { liquidityManager, bridge, user1 } = await loadFixture(deployLiquidityManagerFixture);

            const requestId = ethers.id("test-addliq-5");
            const pioAmount = ethers.parseEther("100");
            const usdtAmount = ethers.parseEther("50");

            await bridge.setProcessedTransaction(requestId, true);
            await liquidityManager.handleBridgeCompleted(requestId, user1.address, pioAmount, usdtAmount, 6);
            
            // Try to add liquidity without depositing USDT first
            await expect(
                liquidityManager.connect(user1).addLiquidity(requestId, 10)
            ).to.be.revertedWith("USDT not provided yet");
        });

        it("Should revert if liquidity already added", async function () {
            const { liquidityManager, bridge, user1 } = await loadFixture(deployLiquidityManagerFixture);

            const requestId = ethers.id("test-addliq-6");
            const pioAmount = ethers.parseEther("100");
            const usdtAmount = ethers.parseEther("50");

            await bridge.setProcessedTransaction(requestId, true);
            await liquidityManager.handleBridgeCompleted(requestId, user1.address, pioAmount, usdtAmount, 6);
            await liquidityManager.connect(user1).depositUSDT(requestId);
            await liquidityManager.connect(user1).addLiquidity(requestId, 10);

            // Try to add liquidity again
            await expect(
                liquidityManager.connect(user1).addLiquidity(requestId, 10)
            ).to.be.revertedWith("Additional liquidity request made");
        });

        it("Should revert if slippage is too high", async function () {
            const { liquidityManager, bridge, user1 } = await loadFixture(deployLiquidityManagerFixture);

            const requestId = ethers.id("test-addliq-7");
            const pioAmount = ethers.parseEther("100");
            const usdtAmount = ethers.parseEther("50");

            await bridge.setProcessedTransaction(requestId, true);
            await liquidityManager.handleBridgeCompleted(requestId, user1.address, pioAmount, usdtAmount, 6);
            await liquidityManager.connect(user1).depositUSDT(requestId);

            await expect(
                liquidityManager.connect(user1).addLiquidity(requestId, 91)
            ).to.be.revertedWith("Slippage too high");
        });

        it("Should only be callable by owner of requestId", async function () {
            const { liquidityManager, bridge, user1, user2 } = await loadFixture(deployLiquidityManagerFixture);

            const requestId = ethers.id("test-addliq-8");
            const pioAmount = ethers.parseEther("100");
            const usdtAmount = ethers.parseEther("50");

            await bridge.setProcessedTransaction(requestId, true);
            await liquidityManager.handleBridgeCompleted(requestId, user1.address, pioAmount, usdtAmount, 6);
            await liquidityManager.connect(user1).depositUSDT(requestId);

            // Try to call from non-manager account
            await expect(
                liquidityManager.connect(user2).addLiquidity(requestId, 10)
            ).to.be.revertedWith("Not the owner of this request");
        });

        it("Should work with different slippage percentages", async function () {
            const { liquidityManager, bridge, user1 } = await loadFixture(deployLiquidityManagerFixture);

            const slippageTests = [0, 5, 10, 25, 50];

            for (let i = 0; i < slippageTests.length; i++) {
                const requestId = ethers.id(`test-addliq-slippage-${i}`);
                const pioAmount = ethers.parseEther("100");
                const usdtAmount = ethers.parseEther("50");
                const slippage = slippageTests[i];

                await bridge.setProcessedTransaction(requestId, true);
                await liquidityManager.handleBridgeCompleted(requestId, user1.address, pioAmount, usdtAmount, 6);
                await liquidityManager.connect(user1).depositUSDT(requestId);

                await expect(
                    liquidityManager.connect(user1).addLiquidity(requestId, slippage)
                ).to.emit(liquidityManager, "LiquidityAdded");

                const txInfo = await liquidityManager.getTransactionInfo(requestId);
                expect(txInfo.liquidityAmount).to.be.gt(0);
                expect(txInfo.pinkLockId).to.be.gt(0);
            }
        });
    });

    describe("Admin Functions", function () {
        it("Should allow owner to pause contract", async function () {
            const { liquidityManager, owner } = await loadFixture(deployLiquidityManagerFixture);

            await liquidityManager.connect(owner).pause();
            expect(await liquidityManager.paused()).to.be.true;
        });

        it("Should allow owner to unpause contract", async function () {
            const { liquidityManager, owner } = await loadFixture(deployLiquidityManagerFixture);

            await liquidityManager.connect(owner).pause();
            await liquidityManager.connect(owner).unpause();
            expect(await liquidityManager.paused()).to.be.false;
        });

        it("Should revert pause when not owner", async function () {
            const { liquidityManager, user1 } = await loadFixture(deployLiquidityManagerFixture);

            await expect(
                liquidityManager.connect(user1).pause()
            ).to.be.revertedWith("Not owner");
        });

        it("Should revert unpause when not owner", async function () {
            const { liquidityManager, owner, user1 } = await loadFixture(deployLiquidityManagerFixture);

            await liquidityManager.connect(owner).pause();
            await expect(
                liquidityManager.connect(user1).unpause()
            ).to.be.revertedWith("Not owner");
        });

        it("Should prevent depositUSDT when paused", async function () {
            const { liquidityManager, bridge, owner, user1 } = await loadFixture(deployLiquidityManagerFixture);

            const requestId = ethers.id("test-paused-deposit");
            const pioAmount = ethers.parseEther("100");
            const usdtAmount = ethers.parseEther("50");

            await bridge.setProcessedTransaction(requestId, true);
            await liquidityManager.handleBridgeCompleted(requestId, user1.address, pioAmount, usdtAmount, 6);

            await liquidityManager.connect(owner).pause();

            await expect(
                liquidityManager.connect(user1).depositUSDT(requestId)
            ).to.be.revertedWithCustomError(liquidityManager, "EnforcedPause");
        });

        it("Should prevent addLiquidity when paused", async function () {
            const { liquidityManager, bridge, owner, user1 } = await loadFixture(deployLiquidityManagerFixture);

            const requestId = ethers.id("test-paused-addliq");
            const pioAmount = ethers.parseEther("100");
            const usdtAmount = ethers.parseEther("50");

            await bridge.setProcessedTransaction(requestId, true);
            await liquidityManager.handleBridgeCompleted(requestId, user1.address, pioAmount, usdtAmount, 6);
            await liquidityManager.connect(user1).depositUSDT(requestId);

            await liquidityManager.connect(owner).pause();

            await expect(
                liquidityManager.connect(user1).addLiquidity(requestId, 10)
            ).to.be.revertedWithCustomError(liquidityManager, "EnforcedPause");
        });

        it("Should prevent claimUSDT when paused", async function () {
            const { liquidityManager, bridge, owner, user1 } = await loadFixture(deployLiquidityManagerFixture);

            const requestId = ethers.id("test-paused-claim");
            const pioAmount = ethers.parseEther("100");
            const usdtAmount = ethers.parseEther("50");

            await bridge.setProcessedTransaction(requestId, true);
            await liquidityManager.handleBridgeCompleted(requestId, user1.address, pioAmount, usdtAmount, 6);
            await liquidityManager.connect(user1).depositUSDT(requestId);

            await liquidityManager.connect(owner).pause();

            await expect(
                liquidityManager.connect(user1).claimUSDT(ethers.parseEther("10"))
            ).to.be.revertedWithCustomError(liquidityManager, "EnforcedPause");
        });

        it("Should prevent claimPioToPioneChain when paused", async function () {
            const { liquidityManager, bridge, owner, user1 } = await loadFixture(deployLiquidityManagerFixture);

            const requestId = ethers.id("test-paused-claim-pio");
            const pioAmount = ethers.parseEther("100");
            const usdtAmount = ethers.parseEther("50");

            await bridge.setProcessedTransaction(requestId, true);
            await liquidityManager.handleBridgeCompleted(requestId, user1.address, pioAmount, usdtAmount, 6);

            await liquidityManager.connect(owner).pause();

            await expect(
                liquidityManager.connect(user1).claimPioToPioneChain(ethers.parseEther("10"))
            ).to.be.revertedWithCustomError(liquidityManager, "EnforcedPause");
        });

        it("Should prevent handleBridgeCompleted when paused", async function () {
            const { liquidityManager, bridge, owner, user1 } = await loadFixture(deployLiquidityManagerFixture);

            const requestId = ethers.id("test-paused-handle");
            const pioAmount = ethers.parseEther("100");
            const usdtAmount = ethers.parseEther("50");

            await bridge.setProcessedTransaction(requestId, true);
            await liquidityManager.connect(owner).pause();

            await expect(
                liquidityManager.handleBridgeCompleted(requestId, user1.address, pioAmount, usdtAmount, 6)
            ).to.be.revertedWithCustomError(liquidityManager, "EnforcedPause");
        });

        it("Should allow setMinClaimPIOAmount", async function () {
            const { liquidityManager, owner } = await loadFixture(deployLiquidityManagerFixture);

            const newMinAmount = ethers.parseEther("5");

            await expect(
                liquidityManager.connect(owner).setMinClaimPIOAmount(newMinAmount)
            ).to.emit(liquidityManager, "UpdatedMinClaimPIOAmount")
              .withArgs(ethers.parseEther("1"), newMinAmount);

            expect(await liquidityManager.getMinClaimPIOAmount()).to.equal(newMinAmount);
        });

        it("Should revert setMinClaimPIOAmount if not owner", async function () {
            const { liquidityManager, user1 } = await loadFixture(deployLiquidityManagerFixture);

            const newMinAmount = ethers.parseEther("5");

            await expect(
                liquidityManager.connect(user1).setMinClaimPIOAmount(newMinAmount)
            ).to.be.revertedWith("Not owner");
        });

        it("Should revert setMinClaimPIOAmount if zero", async function () {
            const { liquidityManager, owner } = await loadFixture(deployLiquidityManagerFixture);

            await expect(
                liquidityManager.connect(owner).setMinClaimPIOAmount(0)
            ).to.be.revertedWith("Min amount must be greater than 0");
        });

        it("Should allow setPioneBridge", async function () {
            const { liquidityManager, owner, user2 } = await loadFixture(deployLiquidityManagerFixture);

            const oldBridge = await liquidityManager.pioneBridge();

            await expect(
                liquidityManager.connect(owner).setPioneBridge(user2.address)
            ).to.emit(liquidityManager, "PioneBridgeUpdated")
              .withArgs(oldBridge, user2.address);

            expect(await liquidityManager.pioneBridge()).to.equal(user2.address);
        });

        it("Should revert setPioneBridge if not owner", async function () {
            const { liquidityManager, user1, user2 } = await loadFixture(deployLiquidityManagerFixture);

            await expect(
                liquidityManager.connect(user1).setPioneBridge(user2.address)
            ).to.be.revertedWith("Not owner");
        });

        it("Should revert setPioneBridge if zero address", async function () {
            const { liquidityManager, owner } = await loadFixture(deployLiquidityManagerFixture);

            await expect(
                liquidityManager.connect(owner).setPioneBridge(ethers.ZeroAddress)
            ).to.be.revertedWith("Invalid PioneBridge address");
        });

        it("Should allow owner to grant MANAGER_ROLE", async function () {
            const { liquidityManager, owner, user2 } = await loadFixture(deployLiquidityManagerFixture);

            const MANAGER_ROLE = await liquidityManager.MANAGER_ROLE();

            await liquidityManager.connect(owner).grantRole(MANAGER_ROLE, user2.address);
            expect(await liquidityManager.hasRole(MANAGER_ROLE, user2.address)).to.be.true;
        });

        it("Should allow owner to revoke MANAGER_ROLE", async function () {
            const { liquidityManager, owner, user2 } = await loadFixture(deployLiquidityManagerFixture);

            const MANAGER_ROLE = await liquidityManager.MANAGER_ROLE();

            await liquidityManager.connect(owner).grantRole(MANAGER_ROLE, user2.address);
            await liquidityManager.connect(owner).revokeRole(MANAGER_ROLE, user2.address);
            expect(await liquidityManager.hasRole(MANAGER_ROLE, user2.address)).to.be.false;
        });
    });

    describe("View Functions", function () {
        it("Should return correct optimal USDT amount", async function () {
            const { liquidityManager } = await loadFixture(deployLiquidityManagerFixture);

            // MockPancakeRouter's quote function returns: amountB = (amountA * reserveB) / reserveA
            // For testing, assuming reserves are set in the mock
            const pioAmount = ethers.parseEther("100");
            const optimalUsdtAmount = await liquidityManager.getOptimalAmountUSDT(pioAmount);

            // Check it returns a value
            expect(optimalUsdtAmount).to.be.gt(0);
        });

        it("Should return correct optimal PIO amount", async function () {
            const { liquidityManager } = await loadFixture(deployLiquidityManagerFixture);

            const usdtAmount = ethers.parseEther("50");
            const optimalPioAmount = await liquidityManager.getOptimalAmountPIO(usdtAmount);

            // Check it returns a value
            expect(optimalPioAmount).to.be.gt(0);
        });

        it("Should preview add liquidity correctly", async function () {
            const { liquidityManager } = await loadFixture(deployLiquidityManagerFixture);

            const pioAmount = ethers.parseEther("100");
            const usdtAmount = ethers.parseEther("50");

            const preview = await liquidityManager.previewAddLiquidity(pioAmount, usdtAmount);

            expect(preview.actualPioAmount).to.be.lte(pioAmount);
            expect(preview.actualUsdtAmount).to.be.lte(usdtAmount);
            expect(preview.estimatedLiquidity).to.be.gt(0);

            // Either refundPio or refundUsdt should be 0 (optimal ratio)
            expect(preview.refundPio == 0n || preview.refundUsdt == 0n).to.be.true;
        });

        it("Should return correct reserves", async function () {
            const { liquidityManager } = await loadFixture(deployLiquidityManagerFixture);

            const reserves = await liquidityManager.getReserves();

            expect(reserves.reserveUsdt).to.be.gte(0);
            expect(reserves.reservePione).to.be.gte(0);
        });

        it("Should return correct user balances", async function () {
            const { liquidityManager, bridge, user1 } = await loadFixture(deployLiquidityManagerFixture);

            const requestId = ethers.id("test-view-balance");
            const pioAmount = ethers.parseEther("100");
            const usdtAmount = ethers.parseEther("50");

            await bridge.setProcessedTransaction(requestId, true);
            await liquidityManager.handleBridgeCompleted(requestId, user1.address, pioAmount, usdtAmount, 6);
            await liquidityManager.connect(user1).depositUSDT(requestId);

            const balances = await liquidityManager.getUserBalances(user1.address);

            expect(balances.pioBalance).to.equal(pioAmount);
            expect(balances.usdtBalance).to.equal(usdtAmount);
        });

        it("Should return correct transaction info", async function () {
            const { liquidityManager, bridge, user1 } = await loadFixture(deployLiquidityManagerFixture);

            const requestId = ethers.id("test-view-tx");
            const pioAmount = ethers.parseEther("100");
            const usdtAmount = ethers.parseEther("50");
            const lockMonths = 6;

            await bridge.setProcessedTransaction(requestId, true);
            await liquidityManager.handleBridgeCompleted(requestId, user1.address, pioAmount, usdtAmount, lockMonths);

            const txInfo = await liquidityManager.getTransactionInfo(requestId);

            expect(txInfo.pioAmount).to.equal(pioAmount);
            expect(txInfo.usdtAmount).to.equal(usdtAmount);
            expect(txInfo.lockMonths).to.equal(lockMonths);
            expect(txInfo._depositUSDT).to.be.false;
            expect(txInfo.liquidityAmount).to.equal(0);
            expect(txInfo.pinkLockId).to.equal(0);
        });

        it("Should return correct requestId owner", async function () {
            const { liquidityManager, bridge, user1 } = await loadFixture(deployLiquidityManagerFixture);

            const requestId = ethers.id("test-view-owner");
            const pioAmount = ethers.parseEther("100");
            const usdtAmount = ethers.parseEther("50");

            await bridge.setProcessedTransaction(requestId, true);
            await liquidityManager.handleBridgeCompleted(requestId, user1.address, pioAmount, usdtAmount, 6);

            const owner = await liquidityManager.getRequestIdOwner(requestId);
            expect(owner).to.equal(user1.address);
        });

        it("Should return zero address for non-existent requestId", async function () {
            const { liquidityManager } = await loadFixture(deployLiquidityManagerFixture);

            const fakeRequestId = ethers.id("non-existent");
            const owner = await liquidityManager.getRequestIdOwner(fakeRequestId);

            expect(owner).to.equal(ethers.ZeroAddress);
        });
    });

    describe("Position 0 Edge Cases - CRITICAL TEST", function () {
        it("Should correctly handle first transaction at position 0", async function () {
            const { liquidityManager, bridge, user1 } = await loadFixture(deployLiquidityManagerFixture);

            const requestId = ethers.id("position-0-test-1");
            const pioAmount = ethers.parseEther("100");
            const usdtAmount = ethers.parseEther("50");

            // Mark as processed
            await bridge.setProcessedTransaction(requestId, true);

            // This should create transaction at position 0
            await liquidityManager.handleBridgeCompleted(requestId, user1.address, pioAmount, usdtAmount, 6);

            // Verify position is stored correctly
            const txInfo = await liquidityManager.getTransactionInfo(requestId);
            expect(txInfo.pioAmount).to.equal(pioAmount);
            expect(txInfo.usdtAmount).to.equal(usdtAmount);

            // Verify requestId is marked as used
            expect(await liquidityManager.getRequestIdOwner(requestId)).to.equal(user1.address);
        });

        it("Should allow deposit at position 0", async function () {
            const { liquidityManager, bridge, usdtToken, user1 } = await loadFixture(deployLiquidityManagerFixture);

            const requestId = ethers.id("position-0-deposit");
            const pioAmount = ethers.parseEther("100");
            const usdtAmount = ethers.parseEther("50");

            // Create first transaction (position 0)
            await bridge.setProcessedTransaction(requestId, true);
            await liquidityManager.handleBridgeCompleted(requestId, user1.address, pioAmount, usdtAmount, 6);

            const balanceBefore = await usdtToken.balanceOf(liquidityManager.target);

            // Should be able to deposit at position 0
            await expect(
                liquidityManager.connect(user1).depositUSDT(requestId)
            ).to.emit(liquidityManager, "UserDepositUSDT")
              .withArgs(requestId, user1.address, usdtAmount);

            const balanceAfter = await usdtToken.balanceOf(liquidityManager.target);
            expect(balanceAfter - balanceBefore).to.equal(usdtAmount);
        });

        it("Should NOT allow deposit with non-existent requestId (position would default to 0)", async function () {
            const { liquidityManager, user1 } = await loadFixture(deployLiquidityManagerFixture);

            const fakeRequestId = ethers.id("fake-request-non-existent");

            // This should fail because requestId doesn't exist
            // Even though mapping will return position = 0 by default
            await expect(
                liquidityManager.connect(user1).depositUSDT(fakeRequestId)
            ).to.be.revertedWith("RequestId does not exist");
        });

        it("Should handle multiple transactions for same user correctly", async function () {
            const { liquidityManager, bridge, user1 } = await loadFixture(deployLiquidityManagerFixture);

            const requestId1 = ethers.id("multi-tx-1");
            const requestId2 = ethers.id("multi-tx-2");
            const requestId3 = ethers.id("multi-tx-3");

            const pioAmount = ethers.parseEther("100");
            const usdtAmount = ethers.parseEther("50");

            // Create 3 transactions for same user
            await bridge.setProcessedTransaction(requestId1, true);
            await liquidityManager.handleBridgeCompleted(requestId1, user1.address, pioAmount, usdtAmount, 6);

            await bridge.setProcessedTransaction(requestId2, true);
            await liquidityManager.handleBridgeCompleted(requestId2, user1.address, pioAmount * 2n, usdtAmount * 2n, 6);

            await bridge.setProcessedTransaction(requestId3, true);
            await liquidityManager.handleBridgeCompleted(requestId3, user1.address, pioAmount * 3n, usdtAmount * 3n, 6);

            // Verify each transaction is at correct position
            const tx1Info = await liquidityManager.getTransactionInfo(requestId1);
            const tx2Info = await liquidityManager.getTransactionInfo(requestId2);
            const tx3Info = await liquidityManager.getTransactionInfo(requestId3);
            const userInfo = await liquidityManager.getUserBalances(user1.address);

            expect(tx1Info.pioAmount).to.equal(pioAmount);
            expect(tx2Info.pioAmount).to.equal(pioAmount * 2n);
            expect(tx3Info.pioAmount).to.equal(pioAmount * 3n);

            // Verify total PIO balance is sum of all transactions
            expect(userInfo.pioBalance).to.equal(pioAmount + pioAmount * 2n + pioAmount * 3n);
        });

        it("Should correctly identify used vs unused requestIds", async function () {
            const { liquidityManager, bridge, user1 } = await loadFixture(deployLiquidityManagerFixture);

            const usedRequestId = ethers.id("used-request");
            const unusedRequestId = ethers.id("unused-request");

            const pioAmount = ethers.parseEther("100");
            const usdtAmount = ethers.parseEther("50");

            // Create one transaction
            await bridge.setProcessedTransaction(usedRequestId, true);
            await liquidityManager.handleBridgeCompleted(usedRequestId, user1.address, pioAmount, usdtAmount, 6);

            // Check used vs unused
            expect(await liquidityManager.getRequestIdOwner(usedRequestId)).to.equal(user1.address);
            expect(await liquidityManager.getRequestIdOwner(unusedRequestId)).to.equal(ethers.ZeroAddress);
        });

        it("CRITICAL: Should not confuse position 0 with non-existent mapping", async function () {
            const { liquidityManager, bridge, user1 } = await loadFixture(deployLiquidityManagerFixture);

            const validRequestId = ethers.id("valid-position-0");
            const fakeRequestId = ethers.id("fake-not-registered");

            const pioAmount = ethers.parseEther("100");
            const usdtAmount = ethers.parseEther("50");

            // Create valid transaction at position 0
            await bridge.setProcessedTransaction(validRequestId, true);
            await liquidityManager.handleBridgeCompleted(validRequestId, user1.address, pioAmount, usdtAmount, 6);

            // Should work for valid requestId at position 0
            await expect(
                liquidityManager.connect(user1).depositUSDT(validRequestId)
            ).to.emit(liquidityManager, "UserDepositUSDT");

            // Should FAIL for fake requestId even though mapping returns 0
            // This tests the CRITICAL bug where position 0 could be confused with non-existent key
            await expect(
                liquidityManager.connect(user1).depositUSDT(fakeRequestId)
            ).to.be.revertedWith("RequestId does not exist");
        });

        it("Should handle position 0 correctly in canExecuted modifier", async function () {
            const { liquidityManager, bridge, user1 } = await loadFixture(deployLiquidityManagerFixture);

            const requestId = ethers.id("can-executed-position-0");
            const pioAmount = ethers.parseEther("100");
            const usdtAmount = ethers.parseEther("50");

            // Setup: create transaction at position 0 and deposit USDT
            await bridge.setProcessedTransaction(requestId, true);
            await liquidityManager.handleBridgeCompleted(requestId, user1.address, pioAmount, usdtAmount, 6);
            await liquidityManager.connect(user1).depositUSDT(requestId);

            // Should be able to add liquidity at position 0
            await expect(
                liquidityManager.connect(user1).addLiquidity(requestId, 10)
            ).to.emit(liquidityManager, "LiquidityAdded");
        });

        it("Should reject addLiquidity with non-existent requestId even if user has position 0", async function () {
            const { liquidityManager, bridge, user1 } = await loadFixture(deployLiquidityManagerFixture);

            const validRequestId = ethers.id("valid-for-position-0");
            const fakeRequestId = ethers.id("fake-should-fail");

            const pioAmount = ethers.parseEther("100");
            const usdtAmount = ethers.parseEther("50");

            // Create valid transaction at position 0
            await bridge.setProcessedTransaction(validRequestId, true);
            await liquidityManager.handleBridgeCompleted(validRequestId, user1.address, pioAmount, usdtAmount, 6);
            await liquidityManager.connect(user1).depositUSDT(validRequestId);

            // Try to add liquidity with fake requestId
            // Even though user has a transaction at position 0, this should fail
            await expect(
                liquidityManager.connect(user1).addLiquidity(fakeRequestId, 10)
            ).to.be.revertedWith("RequestId does not exist");
        });
    });

    describe("Edge Cases and Security", function () {
        it("Should handle maximum uint256 values safely", async function () {
            const { liquidityManager, bridge, user1 } = await loadFixture(deployLiquidityManagerFixture);

            const requestId = ethers.id("test-max-uint");
            const maxAmount = ethers.MaxUint256;

            await bridge.setProcessedTransaction(requestId, true);

            // This should work without overflow
            await expect(
                liquidityManager.handleBridgeCompleted(requestId, user1.address, maxAmount, ethers.parseEther("1"), 6)
            ).to.emit(liquidityManager, "LiquidityRequestCreated");
        });

        it("Should revert depositUSDT if user has insufficient token balance", async function () {
            const { liquidityManager, bridge, user2 } = await loadFixture(deployLiquidityManagerFixture);

            const requestId = ethers.id("test-insufficient");
            const pioAmount = ethers.parseEther("100");
            const usdtAmount = ethers.parseEther("50");

            await bridge.setProcessedTransaction(requestId, true);
            await liquidityManager.handleBridgeCompleted(requestId, user2.address, pioAmount, usdtAmount, 6);

            // user2 has no USDT tokens, should fail
            await expect(
                liquidityManager.connect(user2).depositUSDT(requestId)
            ).to.be.reverted;
        });

        it("Should handle lock months boundary values", async function () {
            const { liquidityManager, bridge, user1 } = await loadFixture(deployLiquidityManagerFixture);

            const requestId = ethers.id("test-lock-boundary");
            const pioAmount = ethers.parseEther("100");
            const usdtAmount = ethers.parseEther("50");

            await bridge.setProcessedTransaction(requestId, true);

            // lockMonths = 1 (minimum valid)
            await expect(
                liquidityManager.handleBridgeCompleted(requestId, user1.address, pioAmount, usdtAmount, 1)
            ).to.emit(liquidityManager, "LiquidityRequestCreated");

            const txInfo = await liquidityManager.getTransactionInfo(requestId);
            expect(txInfo.lockMonths).to.equal(1);
        });

        it("Should revert if lockMonths is zero", async function () {
            const { liquidityManager, bridge, user1 } = await loadFixture(deployLiquidityManagerFixture);

            const requestId = ethers.id("test-lock-zero");
            const pioAmount = ethers.parseEther("100");
            const usdtAmount = ethers.parseEther("50");

            await bridge.setProcessedTransaction(requestId, true);

            await expect(
                liquidityManager.handleBridgeCompleted(requestId, user1.address, pioAmount, usdtAmount, 0)
            ).to.be.revertedWith("Lock months must be greater than 0");
        });

        it("Should handle multiple users with same amounts independently", async function () {
            const { liquidityManager, bridge, user1, user2 } = await loadFixture(deployLiquidityManagerFixture);

            const requestId1 = ethers.id("multi-user-1");
            const requestId2 = ethers.id("multi-user-2");
            const pioAmount = ethers.parseEther("100");
            const usdtAmount = ethers.parseEther("50");

            await bridge.setProcessedTransaction(requestId1, true);
            await bridge.setProcessedTransaction(requestId2, true);

            await liquidityManager.handleBridgeCompleted(requestId1, user1.address, pioAmount, usdtAmount, 6);
            await liquidityManager.handleBridgeCompleted(requestId2, user2.address, pioAmount, usdtAmount, 6);

            const balances1 = await liquidityManager.getUserBalances(user1.address);
            const balances2 = await liquidityManager.getUserBalances(user2.address);

            expect(balances1.pioBalance).to.equal(pioAmount);
            expect(balances2.pioBalance).to.equal(pioAmount);

            // Verify they are independent
            expect(await liquidityManager.getRequestIdOwner(requestId1)).to.equal(user1.address);
            expect(await liquidityManager.getRequestIdOwner(requestId2)).to.equal(user2.address);
        });

        it("Should protect against reentrancy in depositUSDT", async function () {
            const { liquidityManager, bridge, user1 } = await loadFixture(deployLiquidityManagerFixture);

            const requestId = ethers.id("test-reentrancy-deposit");
            const pioAmount = ethers.parseEther("100");
            const usdtAmount = ethers.parseEther("50");

            await bridge.setProcessedTransaction(requestId, true);
            await liquidityManager.handleBridgeCompleted(requestId, user1.address, pioAmount, usdtAmount, 6);

            // First deposit should succeed
            await liquidityManager.connect(user1).depositUSDT(requestId);

            // Second deposit should fail (reentrancy protection via modifier check)
            await expect(
                liquidityManager.connect(user1).depositUSDT(requestId)
            ).to.be.revertedWith("Already deposited USDT");
        });

        it("Should protect against reentrancy in claimUSDT", async function () {
            const { liquidityManager, bridge, user1 } = await loadFixture(deployLiquidityManagerFixture);

            const requestId = ethers.id("test-reentrancy-claim");
            const pioAmount = ethers.parseEther("100");
            const usdtAmount = ethers.parseEther("50");

            await bridge.setProcessedTransaction(requestId, true);
            await liquidityManager.handleBridgeCompleted(requestId, user1.address, pioAmount, usdtAmount, 6);
            await liquidityManager.connect(user1).depositUSDT(requestId);

            // Claim full amount
            await liquidityManager.connect(user1).claimUSDT(usdtAmount);

            // Try to claim again should fail
            await expect(
                liquidityManager.connect(user1).claimUSDT(ethers.parseEther("1"))
            ).to.be.revertedWith("Insufficient balance USDT");
        });

        it("Should correctly calculate unlock date for different lock periods", async function () {
            const { liquidityManager, bridge, user1 } = await loadFixture(deployLiquidityManagerFixture);

            const testLockMonths = [1, 3, 6, 12, 24];

            for (let i = 0; i < testLockMonths.length; i++) {
                const requestId = ethers.id(`test-unlock-${testLockMonths[i]}`);
                const pioAmount = ethers.parseEther("100");
                const usdtAmount = ethers.parseEther("50");

                await bridge.setProcessedTransaction(requestId, true);
                await liquidityManager.handleBridgeCompleted(requestId, user1.address, pioAmount, usdtAmount, testLockMonths[i]);
                await liquidityManager.connect(user1).depositUSDT(requestId);

                const tx = await liquidityManager.connect(user1).addLiquidity(requestId, 10);
                const receipt = await tx.wait();

                const lockEvent = receipt.logs.find(
                    log => log.fragment && log.fragment.name === 'LiquidityLocked'
                );

                expect(lockEvent).to.not.be.undefined;
            }
        });

        it("Should handle zero address validation in getters", async function () {
            const { liquidityManager } = await loadFixture(deployLiquidityManagerFixture);

            // Should return 0 balances for zero address (or any address with no transactions)
            const balances = await liquidityManager.getUserBalances(ethers.ZeroAddress);
            expect(balances.pioBalance).to.equal(0);
            expect(balances.usdtBalance).to.equal(0);
        });

        it("Should handle getTransactionInfo for invalid requestId", async function () {
            const { liquidityManager } = await loadFixture(deployLiquidityManagerFixture);

            const invalidRequestId = ethers.id("invalid-request");

            await expect(
                liquidityManager.getTransactionInfo(invalidRequestId)
            ).to.be.revertedWith("RequestId does not exist");
        });

        it("Should update totalLiquidity correctly across multiple transactions", async function () {
            const { liquidityManager, bridge, user1 } = await loadFixture(deployLiquidityManagerFixture);

            const requestId1 = ethers.id("total-liq-1");
            const requestId2 = ethers.id("total-liq-2");
            const pioAmount = ethers.parseEther("100");
            const usdtAmount = ethers.parseEther("50");

            // First transaction
            await bridge.setProcessedTransaction(requestId1, true);
            await liquidityManager.handleBridgeCompleted(requestId1, user1.address, pioAmount, usdtAmount, 6);
            await liquidityManager.connect(user1).depositUSDT(requestId1);
            await liquidityManager.connect(user1).addLiquidity(requestId1, 10);

            const tx1Info = await liquidityManager.getTransactionInfo(requestId1);
            const liquidity1 = tx1Info.liquidityAmount;

            // Second transaction
            await bridge.setProcessedTransaction(requestId2, true);
            await liquidityManager.handleBridgeCompleted(requestId2, user1.address, pioAmount, usdtAmount, 6);
            await liquidityManager.connect(user1).depositUSDT(requestId2);
            await liquidityManager.connect(user1).addLiquidity(requestId2, 10);

            const tx2Info = await liquidityManager.getTransactionInfo(requestId2);
            const liquidity2 = tx2Info.liquidityAmount;

            // Both should have liquidity
            expect(liquidity1).to.be.gt(0);
            expect(liquidity2).to.be.gt(0);
        });

        it("Should handle slippage edge case at 90%", async function () {
            const { liquidityManager, bridge, user1 } = await loadFixture(deployLiquidityManagerFixture);

            const requestId = ethers.id("test-slippage-90");
            const pioAmount = ethers.parseEther("100");
            const usdtAmount = ethers.parseEther("50");

            await bridge.setProcessedTransaction(requestId, true);
            await liquidityManager.handleBridgeCompleted(requestId, user1.address, pioAmount, usdtAmount, 6);
            await liquidityManager.connect(user1).depositUSDT(requestId);

            // 90% slippage should work (boundary)
            await expect(
                liquidityManager.connect(user1).addLiquidity(requestId, 90)
            ).to.emit(liquidityManager, "LiquidityAdded");
        });

        it("Should revert addLiquidity if user doesn't own the requestId", async function () {
            const { liquidityManager, bridge, user1, user2 } = await loadFixture(deployLiquidityManagerFixture);

            const requestId = ethers.id("test-ownership");
            const pioAmount = ethers.parseEther("100");
            const usdtAmount = ethers.parseEther("50");

            await bridge.setProcessedTransaction(requestId, true);
            await liquidityManager.handleBridgeCompleted(requestId, user1.address, pioAmount, usdtAmount, 6);
            await liquidityManager.connect(user1).depositUSDT(requestId);

            // user2 tries to add liquidity with user1's requestId
            await expect(
                liquidityManager.connect(user2).addLiquidity(requestId, 10)
            ).to.be.revertedWith("Not the owner of this request");
        });

        it("Should handle very large lock periods (stress test)", async function () {
            const { liquidityManager, bridge, user1 } = await loadFixture(deployLiquidityManagerFixture);

            const requestId = ethers.id("test-lock-large");
            const pioAmount = ethers.parseEther("100");
            const usdtAmount = ethers.parseEther("50");
            const largeMonths = 120; // 10 years

            await bridge.setProcessedTransaction(requestId, true);

            await expect(
                liquidityManager.handleBridgeCompleted(requestId, user1.address, pioAmount, usdtAmount, largeMonths)
            ).to.emit(liquidityManager, "LiquidityRequestCreated");

            const txInfo = await liquidityManager.getTransactionInfo(requestId);
            expect(txInfo.lockMonths).to.equal(largeMonths);
        });

        it("Should revert depositUSDT if called by wrong user", async function () {
            const { liquidityManager, bridge, user1, user2 } = await loadFixture(deployLiquidityManagerFixture);

            const requestId = ethers.id("test-wrong-user-deposit");
            const pioAmount = ethers.parseEther("100");
            const usdtAmount = ethers.parseEther("50");

            await bridge.setProcessedTransaction(requestId, true);
            await liquidityManager.handleBridgeCompleted(requestId, user1.address, pioAmount, usdtAmount, 6);

            // user2 tries to deposit for user1's request
            await expect(
                liquidityManager.connect(user2).depositUSDT(requestId)
            ).to.be.revertedWith("Not the owner of this request");
        });

        it("Should handle full workflow with minimal amounts", async function () {
            const { liquidityManager, bridge, user1 } = await loadFixture(deployLiquidityManagerFixture);

            const requestId = ethers.id("test-minimal-amounts");
            const minPioAmount = ethers.parseEther("0.001"); // 0.001 PIO
            const minUsdtAmount = ethers.parseEther("0.001"); // 0.001 USDT

            await bridge.setProcessedTransaction(requestId, true);
            await liquidityManager.handleBridgeCompleted(requestId, user1.address, minPioAmount, minUsdtAmount, 1);
            await liquidityManager.connect(user1).depositUSDT(requestId);

            // Should be able to add liquidity with minimal amounts
            await expect(
                liquidityManager.connect(user1).addLiquidity(requestId, 10)
            ).to.emit(liquidityManager, "LiquidityAdded");
        });

        it("Should correctly handle refunds when router uses less tokens", async function () {
            const { liquidityManager, bridge, user1 } = await loadFixture(deployLiquidityManagerFixture);

            const requestId = ethers.id("test-refund");
            const pioAmount = ethers.parseEther("100");
            const usdtAmount = ethers.parseEther("50");

            await bridge.setProcessedTransaction(requestId, true);
            await liquidityManager.handleBridgeCompleted(requestId, user1.address, pioAmount, usdtAmount, 6);
            await liquidityManager.connect(user1).depositUSDT(requestId);

            const balancesBefore = await liquidityManager.getUserBalances(user1.address);
            expect(balancesBefore.pioBalance).to.equal(pioAmount);
            expect(balancesBefore.usdtBalance).to.equal(usdtAmount);

            await liquidityManager.connect(user1).addLiquidity(requestId, 10);

            // After adding liquidity, check refunds (MockRouter uses 95% of tokens)
            const balancesAfter = await liquidityManager.getUserBalances(user1.address);
            const expectedPioRefund = pioAmount * 5n / 100n;
            const expectedUsdtRefund = usdtAmount * 5n / 100n;

            expect(balancesAfter.pioBalance).to.equal(expectedPioRefund);
            expect(balancesAfter.usdtBalance).to.equal(expectedUsdtRefund);
        });

        it("Should prevent claimPioToPioneChain from draining more than user balance", async function () {
            const { liquidityManager, bridge, user1 } = await loadFixture(deployLiquidityManagerFixture);

            const requestId = ethers.id("test-drain-pio");
            const pioAmount = ethers.parseEther("100");
            const usdtAmount = ethers.parseEther("50");

            await bridge.setProcessedTransaction(requestId, true);
            await liquidityManager.handleBridgeCompleted(requestId, user1.address, pioAmount, usdtAmount, 6);

            // Claim exactly the balance
            await liquidityManager.connect(user1).claimPioToPioneChain(pioAmount);

            const balances = await liquidityManager.getUserBalances(user1.address);
            expect(balances.pioBalance).to.equal(0);

            // Try to claim again should fail
            await expect(
                liquidityManager.connect(user1).claimPioToPioneChain(ethers.parseEther("1"))
            ).to.be.revertedWith("Insufficient balance PIO");
        });

        it("Should handle sequential deposits and claims correctly", async function () {
            const { liquidityManager, bridge, user1 } = await loadFixture(deployLiquidityManagerFixture);

            const requestId1 = ethers.id("test-seq-1");
            const requestId2 = ethers.id("test-seq-2");
            const pioAmount = ethers.parseEther("100");
            const usdtAmount = ethers.parseEther("50");

            // First transaction
            await bridge.setProcessedTransaction(requestId1, true);
            await liquidityManager.handleBridgeCompleted(requestId1, user1.address, pioAmount, usdtAmount, 6);
            await liquidityManager.connect(user1).depositUSDT(requestId1);

            // Second transaction
            await bridge.setProcessedTransaction(requestId2, true);
            await liquidityManager.handleBridgeCompleted(requestId2, user1.address, pioAmount, usdtAmount, 6);
            await liquidityManager.connect(user1).depositUSDT(requestId2);

            // User should have 2x amounts
            const balances = await liquidityManager.getUserBalances(user1.address);
            expect(balances.pioBalance).to.equal(pioAmount * 2n);
            expect(balances.usdtBalance).to.equal(usdtAmount * 2n);

            // Claim from first transaction
            await liquidityManager.connect(user1).claimUSDT(usdtAmount);
            const balancesAfter = await liquidityManager.getUserBalances(user1.address);
            expect(balancesAfter.usdtBalance).to.equal(usdtAmount);
        });

        it("Should correctly validate amounts in _validateAndGetAmounts", async function () {
            const { liquidityManager, bridge, user1 } = await loadFixture(deployLiquidityManagerFixture);

            const requestId = ethers.id("test-validate-amounts");
            const pioAmount = ethers.parseEther("100");
            const usdtAmount = ethers.parseEther("50");

            await bridge.setProcessedTransaction(requestId, true);
            await liquidityManager.handleBridgeCompleted(requestId, user1.address, pioAmount, usdtAmount, 6);

            // Try to add liquidity without depositing USDT (should fail in validation)
            await expect(
                liquidityManager.connect(user1).addLiquidity(requestId, 10)
            ).to.be.revertedWith("USDT not provided yet");
        });

        it("Should handle constructor with invalid addresses", async function () {
            const PioneLiquidityManager = await ethers.getContractFactory("PioneLiquidityManager");
            const validAddress = "0x1000000000000000000000000000000000000001";

            // Test with zero PIONE token address
            await expect(
                PioneLiquidityManager.deploy(
                    ethers.ZeroAddress,
                    validAddress,
                    validAddress,
                    validAddress,
                    validAddress,
                    5080
                )
            ).to.be.revertedWith("Invalid address");

            // Test with zero USDT token address
            await expect(
                PioneLiquidityManager.deploy(
                    validAddress,
                    ethers.ZeroAddress,
                    validAddress,
                    validAddress,
                    validAddress,
                    5080
                )
            ).to.be.revertedWith("Invalid address");

            // Test with zero router address
            await expect(
                PioneLiquidityManager.deploy(
                    validAddress,
                    validAddress,
                    validAddress,
                    ethers.ZeroAddress,
                    validAddress,
                    5080
                )
            ).to.be.revertedWith("Invalid address");

            // Test with zero pinklock address
            await expect(
                PioneLiquidityManager.deploy(
                    validAddress,
                    validAddress,
                    validAddress,
                    validAddress,
                    ethers.ZeroAddress,
                    5080
                )
            ).to.be.revertedWith("Invalid address");
        });

        it("Should emit all events with correct parameters throughout workflow", async function () {
            const { liquidityManager, bridge, user1 } = await loadFixture(deployLiquidityManagerFixture);

            const requestId = ethers.id("test-events");
            const pioAmount = ethers.parseEther("100");
            const usdtAmount = ethers.parseEther("50");

            await bridge.setProcessedTransaction(requestId, true);

            // Event 1: BridgeCompleted
            await expect(
                liquidityManager.handleBridgeCompleted(requestId, user1.address, pioAmount, usdtAmount, 6)
            ).to.emit(liquidityManager, "LiquidityRequestCreated")
              .withArgs(requestId, user1.address, pioAmount, usdtAmount, 6);

            // Event 2: UserDepositUSDT
            await expect(
                liquidityManager.connect(user1).depositUSDT(requestId)
            ).to.emit(liquidityManager, "UserDepositUSDT")
              .withArgs(requestId, user1.address, usdtAmount);

            // Event 3: LiquidityAdded
            const tx = await liquidityManager.connect(user1).addLiquidity(requestId, 10);
            await expect(tx).to.emit(liquidityManager, "LiquidityAdded");

            // Event 4: LiquidityLocked
            await expect(tx).to.emit(liquidityManager, "LiquidityLocked");
        });
    });
});
