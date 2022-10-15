// SPDX-License-Identifier: MIT
pragma solidity ^0.8.8;

import "@chainlink/contracts/src/v0.8/VRFConsumerBaseV2.sol";
import "@chainlink/contracts/src/v0.8/interfaces/VRFCoordinatorV2Interface.sol";
import "@chainlink/contracts/src/v0.8/interfaces/KeeperCompatibleInterface.sol";

 contract Raffle is VRFConsumerBaseV2, KeeperCompatibleInterface {
     error Raffle__UpkeepNotNeeded(uint256 currentBalance, uint256 numPlayers, uint256 RaffleState); //不需要维护
    error Raffle__NotEnoughETHEntered(); //没有足够的ETH
    error Raffle__TransferFailed(); //转移失败
    error Raffle__RaffleNotOpen(); //抽奖已经关闭
   

    enum RaffleState {
        OPEN,
        CALCULATING
    } //彩票状态，开放，计算中
    address payable[] private s_players;
    VRFCoordinatorV2Interface private immutable i_vrfCoordinator; //VRF协调器

    uint256 private immutable i_entranceFee;
    bytes32 private immutable i_gasLine;
    uint64 private immutable i_subscriptionId;
    uint16 private constant REQUEST_CONFIRMTIONS = 3;
    uint32 private immutable i_callbackGasLimit;
    uint32 private constant NUM_WORDS = 1;

    address private s_recentWinnner;
    RaffleState private s_raffleState;
    uint256 private s_lastTimeStamp;
    uint256 private i_interval;

    event RaffleEnter(address indexed player); //彩票进入
    event RequestedRaffleWinner(uint256 indexed requestId); //请求彩票获胜者
    event WinnerPicked(address indexed winner); //获胜者被选中

    constructor(
        address vrfCoordinatorV2,
        uint256 entranceFee,
        bytes32 gasLine,
        uint64 subscriptionId,
        uint32 callbackGasLimit,
        uint256 interval
    ) VRFConsumerBaseV2(vrfCoordinatorV2) {
        i_entranceFee = entranceFee;
        i_vrfCoordinator = VRFCoordinatorV2Interface(vrfCoordinatorV2);
        i_gasLine = gasLine;//汽油限制
        i_subscriptionId = subscriptionId; //资金请求的订阅ID
        i_callbackGasLimit = callbackGasLimit; //回调函数的gas限制
        s_raffleState = RaffleState.OPEN;
        s_lastTimeStamp = block.timestamp;
        i_interval = interval;//彩票开奖间隔
    }

    function enterRaffle() public payable {
        if (msg.value < i_entranceFee) {
            revert Raffle__NotEnoughETHEntered();
        }
        if (s_raffleState != RaffleState.OPEN) {
            revert Raffle__RaffleNotOpen();
        }
        s_players.push(payable(msg.sender));
        emit RaffleEnter(msg.sender);
    } //进入抽奖

    function checkUpkeep(
        bytes memory /*checkData*/
    )
        public
        view
        override
        returns (
            bool upkeepNeeded,
            bytes memory /*performData*/
        )
    {
        bool isOpen = (s_raffleState == RaffleState.OPEN);
        bool timePassed = ((block.timestamp - s_lastTimeStamp) > i_interval);
        bool enoughPlayers = (s_players.length > 0);
        bool enoughFunds = (address(this).balance >= i_entranceFee);
        upkeepNeeded = (isOpen && timePassed && enoughPlayers && enoughFunds);
        return (upkeepNeeded, "");
    } //检查是否需要执行

    function performUpkeep(
        bytes calldata /*performData*/
    ) external override {
        (bool upkeepNeeded, ) = checkUpkeep("");
        
        if (!upkeepNeeded) {
            revert Raffle__UpkeepNotNeeded(
                address(this).balance,
                s_players.length,
                uint256(s_raffleState)
            );
        }
        s_raffleState = RaffleState.CALCULATING;
        uint256 requestId = i_vrfCoordinator.requestRandomWords(
            i_gasLine,
            i_subscriptionId,
            REQUEST_CONFIRMTIONS, //等待确认的区块数
            i_callbackGasLimit,
            NUM_WORDS 
        );
        emit RequestedRaffleWinner(requestId);
    } //请求随机数

    function fulfillRandomWords(
        uint256, /*requestId*/
        uint256[] memory randomWords
    ) internal override {
        uint256 indexOfWinner = randomWords[0] % s_players.length;
        address payable recentWinner = s_players[indexOfWinner];
        s_recentWinnner = recentWinner; //更新最近的获奖者
        s_raffleState = RaffleState.OPEN; //计算完毕，重新开启抽奖
        s_players = new address payable[](0); //重置玩家列表
        s_lastTimeStamp = block.timestamp; //更新最后一次抽奖的时间戳
        (bool success, ) = recentWinner.call{value: address(this).balance}("");
        if (!success) {
            revert Raffle__TransferFailed();
        } //把奖金转给获奖者
        emit WinnerPicked(recentWinner);
    } //实现随机玩家的抽奖

    function getEntranceFee() public view returns (uint256) {
        return i_entranceFee; //得到入场费的价格
    }

    function getPlayers(uint256 index) public view returns (address) {
        return s_players[index]; //根据玩家的索引返回玩家的地址
    }

    function getRecentWinner() public view returns (address) {
        return s_recentWinnner; //最近的赢家
    }

    function getRaffleState() public view returns (RaffleState) {
        return s_raffleState; //彩票的状态
    }

    function getNumWords() public pure returns (uint32) {
        return NUM_WORDS; //随机数的数量
    }

    function getNumberOfPlayers() public view returns (uint256) {
        return s_players.length; //玩家的数量
    }

    function getLastTimeStamp() public view returns (uint256) {
        return s_lastTimeStamp; //最后一次抽奖的时间戳
    }

    function getRequestConfirmations() public pure returns (uint32) {
        return REQUEST_CONFIRMTIONS; //等待确认的区块数
    }

    function getInterval() public view returns (uint256) {
        return i_interval; //抽奖的间隔
    }

    function getSubscriptionId() public view returns (uint64) {
        return i_subscriptionId; //资金请求的订阅ID
    }
    
    function getCallbackGasLimit() public view returns (uint32) {
        return i_callbackGasLimit; //回调函数的gas限制
    }

   


}
