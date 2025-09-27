// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @notice Destination-side escrow: taker deposits tokens to escrow; maker (user) claims with secret; taker cancels after timeout.
contract EscrowDst {
    using SafeERC20 for IERC20;

    struct Swap {
        address maker; // user on dst
        address taker; // resolver on dst
        IERC20 token;
        uint256 amount;
        bytes32 hashlock;
        bool claimed;
        bool cancelled;
        uint256 withdrawalTime;
        uint256 publicWithdrawalTime;
        uint256 cancellationTime;
    }

    mapping(bytes32 => Swap) public swaps;

    event Locked(
        bytes32 indexed swapId,
        address maker,
        address taker,
        address token,
        uint256 amount,
        bytes32 hashlock,
        uint256 withdrawalTime,
        uint256 publicWithdrawalTime,
        uint256 cancellationTime
    );

    event Claimed(bytes32 indexed swapId, address claimer, bytes32 preimage);
    event Cancelled(bytes32 indexed swapId, address caller);

    /// @notice Lock funds in DST escrow. Called by taker (resolver).
    function lock(
        bytes32 swapId,
        address maker,
        address taker,
        address token,
        uint256 amount,
        bytes32 hashlock,
        uint256 withdrawalTime,
        uint256 publicWithdrawalTime,
        uint256 cancellationTime
    ) external {
        require(swaps[swapId].maker == address(0), "swap exists");
        require(maker != address(0) && taker != address(0), "zero maker/taker");
        require(amount > 0, "zero amount");

        require(withdrawalTime < publicWithdrawalTime, "invalid time order");
        require(publicWithdrawalTime < cancellationTime, "invalid time order");

        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);

        swaps[swapId] = Swap({
            maker: maker,
            taker: taker,
            token: IERC20(token),
            amount: amount,
            hashlock: hashlock,
            claimed: false,
            cancelled: false,
            withdrawalTime: withdrawalTime,
            publicWithdrawalTime: publicWithdrawalTime,
            cancellationTime: cancellationTime
        });

        emit Locked(swapId, maker, taker, token, amount, hashlock, withdrawalTime, publicWithdrawalTime, cancellationTime);
    }

    /// @notice Claim (maker receives funds) by presenting preimage.
    function claim(bytes32 swapId, bytes32 preimage) external {
        Swap storage s = swaps[swapId];
        uint256 nowTs = block.timestamp;

        require(nowTs < s.cancellationTime, "too late, cancellation started");
        require(nowTs >= s.withdrawalTime, "too early for withdrawal");

        // early window: only taker can claim
        if (nowTs < s.publicWithdrawalTime) {
            require(msg.sender == s.taker, "only taker can private claim");
        }

        require(keccak256(abi.encodePacked(preimage)) == s.hashlock, "invalid preimage");
        require(!s.claimed, "already claimed");

        s.claimed = true;

        // pay out to maker (user)
        s.token.safeTransfer(s.maker, s.amount);

        emit Claimed(swapId, msg.sender, preimage);
    }

    /// @notice Cancel after cancellationTime: taker can reclaim funds.
    function cancel(bytes32 swapId) external {
        Swap storage s = swaps[swapId];
        uint256 nowTs = block.timestamp;

        require(nowTs >= s.cancellationTime, "too early to cancel");
        require(msg.sender == s.taker, "only taker can cancel");
        require(!s.cancelled, "already refunded");

        s.cancelled = true;
        s.token.safeTransfer(s.taker, s.amount);

        emit Cancelled(swapId, msg.sender);
    }

    /* View helper */
    function getSwap(bytes32 swapId)
        external
        view
        returns (
            address maker,
            address taker,
            address token,
            uint256 amount,
            bytes32 hashlock,
            bool claimed,
            bool cancelled,
            uint256 withdrawalTime,
            uint256 publicWithdrawalTime,
            uint256 cancellationTime
        )
    {
        Swap storage s = swaps[swapId];
        return (
            s.maker,
            s.taker,
            address(s.token),
            s.amount,
            s.hashlock,
            s.claimed,
            s.cancelled,
            s.withdrawalTime,
            s.publicWithdrawalTime,
            s.cancellationTime
        );
    }
}
