const { assert, expect } = require("chai")
const { network, deployments, ethers } = require("hardhat")
const { developmentChains, networkConfig } = require("../../helper-hardhat-config")

!developmentChains.includes(network.name)
    ? describe.skip
    : describe("Raffle Unit Tests", async function () {
          let raffle,
              raffleContract,
              vrfCoordinatorV2Mock,
              raffleEntranceFee,
              interval,
              player,
              deployer,
                subscriptionId

          beforeEach(async () => {
              accounts = await ethers.getSigners()
              deployer = accounts[0]
              player = accounts[1]
              await deployments.fixture(["mocks", "raffle"])
              raffleContract = await ethers.getContract("Raffle")
              vrfCoordinatorV2Mock = await ethers.getContract("VRFCoordinatorV2Mock")
              raffle = raffleContract.connect(player)
              subscriptionId = await networkConfig[network.config.chainId]['subscriptionId']
            //   await vrfCoordinatorV2Mock.addConsumer(subscriptionId, raffle.address);
              raffleEntranceFee = await raffle.getEntranceFee()
              interval = await raffle.getInterval()
              console.log("______________________________________________")
          })

          describe("constructor", function () {
              it("initializes the raffle contract", async function () {
                  const raffleState = (await raffle.getRaffleState()).toString()
                  assert.equal(raffleState, "0", "Raffle state is not initialized")
                  assert.equal(
                      interval.toString(),
                      networkConfig[network.config.chainId]["keepersUpdateInterval"],
                      "Raffle interval is not initialized"
                  )
              })
          })

          describe("enterRaffle", function () {
              it("reverts when you don't pay enough", async function () {
                  await expect(raffle.enterRaffle()).to.be.revertedWith(
                      "Raffle__NotEnoughETHEntered"
                  )
              })

              it("record the player address", async function () {
                  await raffle.enterRaffle({ value: raffleEntranceFee })
                  const contractPlayer = await raffle.getPlayers(0)
                  assert.equal(contractPlayer, player.address, "Player address is not recorded")
              })

              it("emits event when enterRaffle", async function () {
                  await expect(raffle.enterRaffle({ value: raffleEntranceFee })).to.emit(
                      raffle,
                      "RaffleEnter"
                  )
              })

              it("doesn't allow entrance when raffle is calculating", async () => {
                  await raffle.enterRaffle({ value: raffleEntranceFee })
                  // for a documentation of the methods below, go here: https://hardhat.org/hardhat-network/reference
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                  await network.provider.request({ method: "evm_mine", params: [] })
                  // we pretend to be a keeper for a second
                  console.log("raffle state is: ", (await raffle.getRaffleState()).toString())
                  await raffle.performUpkeep("0x") // changes the state to calculating for our comparison below
                  console.log("raffle state is: ", (await raffle.getRaffleState()).toString())
                  await expect(raffle.enterRaffle({ value: raffleEntranceFee })).to.be.revertedWith(
                      // is reverted as raffle is calculating
                      "Raffle__RaffleNotOpen"
                  )
              })
          })

          describe("checkUpkeep", function () {
              it("returns false if raffle isn't open", async function () {
                  await raffle.enterRaffle({ value: raffleEntranceFee })
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                  await network.provider.request({ method: "evm_mine", params: [] })
                  await raffle.performUpkeep([]) // changes the state to calculating for our comparison below
                  console.log("raffle state is: ", (await raffle.getRaffleState()).toString())
                  const { upkeepNeeded } = await raffle.callStatic.checkUpkeep([]) // upkeepNeeded = (timePassed && isOpen && hasBalance && hasPlayers)
                  assert(!upkeepNeeded, "Upkeep is needed when it shouldn't be")
              })

              it("returns false if raffle havn't enough ETH", async function () {
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                  await network.provider.request({ method: "evm_mine", params: [] })
                  const { upkeepNeeded } = await raffle.callStatic.checkUpkeep([]) // upkeepNeeded = (timePassed && isOpen && hasBalance && hasPlayers)
                  assert(!upkeepNeeded)
              })

              it("returns false if enough time hasn't passed", async () => {
                  await raffle.enterRaffle({ value: raffleEntranceFee })
                  await network.provider.send("evm_increaseTime", [interval.toNumber() - 5]) // use a higher number here if this test fails
                  await network.provider.request({ method: "evm_mine", params: [] })
                  const { upkeepNeeded } = await raffle.callStatic.checkUpkeep("0x") 
                  assert(!upkeepNeeded)
              })

              it("returns true if enough time has passed, has players, eth, and is open", async () => {
                  await raffle.enterRaffle({ value: raffleEntranceFee })
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                  await network.provider.request({ method: "evm_mine", params: [] })
                  const { upkeepNeeded } = await raffle.callStatic.checkUpkeep("0x") 
                  assert(upkeepNeeded)
              })
          })

          describe("performUpkeep", function () {
            it("can only run if checkupkeep is true", async () => {
                await raffle.enterRaffle({ value: raffleEntranceFee })
                await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                await network.provider.request({ method: "evm_mine", params: [] })
                const tx = await raffle.performUpkeep("0x") 
                assert(tx)
            })
            it("reverts if checkup is false", async () => {
                await expect(raffle.performUpkeep("0x")).to.be.revertedWith( 
                    "Raffle__UpkeepNotNeeded"
                )
            })
            it("updates the raffle state and emits a requestId", async () => {
                // Too many asserts in this test!
                await raffle.enterRaffle({ value: raffleEntranceFee })
                await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                await network.provider.request({ method: "evm_mine", params: [] })
                const txResponse = await raffle.performUpkeep("0x") // emits requestId
                const txReceipt = await txResponse.wait(1) // waits 1 block
                const raffleState = await raffle.getRaffleState() // updates state
                const requestId = txReceipt.events[1].args.requestId
                assert(requestId.toNumber() > 0)
                assert(raffleState == 1) // 0 = open, 1 = calculating
            })
        })
        it("picks a winner, resets, and sends money", async () => {
            const additionalEntrances = 3 // to test
            const startingIndex = 2
            for (let i = startingIndex; i < startingIndex + additionalEntrances; i++) { // i = 2; i < 5; i=i+1
                raffle = raffleContract.connect(accounts[i]) // Returns a new instance of the Raffle contract connected to player
                await raffle.enterRaffle({ value: raffleEntranceFee })
            }
            const startingTimeStamp = await raffle.getLastTimeStamp() // stores starting timestamp (before we fire our event)

            // This will be more important for our staging tests...
            await new Promise(async (resolve, reject) => {
                raffle.once("WinnerPicked", async () => { // event listener for WinnerPicked
                    console.log("WinnerPicked event fired!")
                    // assert throws an error if it fails, so we need to wrap
                    // it in a try/catch so that the promise returns event
                    // if it fails.
                    try {
                        // Now lets get the ending values...
                        const recentWinner = await raffle.getRecentWinner()
                        const raffleState = await raffle.getRaffleState()
                        const winnerBalance = await accounts[2].getBalance()
                        const endingTimeStamp = await raffle.getLastTimeStamp()
                        await expect(raffle.getPlayer(0)).to.be.reverted
                        // Comparisons to check if our ending values are correct:
                        assert.equal(recentWinner.toString(), accounts[2].address)
                        assert.equal(raffleState, 0)
                        assert.equal(
                            winnerBalance.toString(), 
                            startingBalance // startingBalance + ( (raffleEntranceFee * additionalEntrances) + raffleEntranceFee )
                                .add(
                                    raffleEntranceFee
                                        .mul(additionalEntrances)
                                        .add(raffleEntranceFee)
                                )
                                .toString()
                        )
                        assert(endingTimeStamp > startingTimeStamp)
                        resolve() // if try passes, resolves the promise 
                    } catch (e) { 
                        reject(e) // if try fails, rejects the promise
                    }
                })

                // kicking off the event by mocking the chainlink keepers and vrf coordinator
                const tx = await raffle.performUpkeep("0x")
                const txReceipt = await tx.wait(1)
                const startingBalance = await accounts[2].getBalance()
                await vrfCoordinatorV2Mock.fulfillRandomWords(
                    txReceipt.events[1].args.requestId,
                    raffle.address
                )
            })
        })
      })
