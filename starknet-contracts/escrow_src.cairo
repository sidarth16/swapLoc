// src/EscrowSrc.cairo
// Source-side escrow: lock funds into Starknet contract.
// Maker deposits & locks ERC20 tokens, Taker claims with secret, Maker refunds after timeout

use starknet::storage::{Map, StorageMapReadAccess, StorageMapWriteAccess};
use starknet::{ContractAddress, get_contract_address, get_caller_address, get_block_timestamp};
use core::integer::u256;
use core::traits::TryInto;

use core::hash::{HashStateTrait};
use core::poseidon::PoseidonTrait;

#[starknet::contract]
mod EscrowSrc {
    use super::*;    

   // Minimal ERC20 dispatcher (replace with OZ ERC20 if available)
    #[starknet::interface]
    trait IERC20<TContractState> {
        fn transfer_from(ref self: TContractState, sender: ContractAddress, recipient: ContractAddress, amount: u256);
        fn transfer(ref self: TContractState, recipient: ContractAddress, amount: u256);
    }


    #[storage]
    struct Storage {
        maker: Map<felt252, ContractAddress>,
        taker: Map<felt252, ContractAddress>,
        token: Map<felt252, ContractAddress>,
        amount: Map<felt252, u256>,
        hashlock: Map<felt252, felt252>,
        timelock: Map<felt252, u64>,
        claimed: Map<felt252, bool>,
        cancelled: Map<felt252, bool>,

        withdrawalTimeLock : Map<felt252, u64>,
        publicWithdrawalTimeLock : Map<felt252, u64>,
        cancellationTimeLock: Map<felt252, u64>,
        publicCancellationTimeLock: Map<felt252, u64>
    }


    // Events
    #[derive(Drop, starknet::Event)]
    struct Locked {
        swap_id: felt252,
        maker: ContractAddress,
        taker: ContractAddress,
        token: ContractAddress,
        amount: u256,
        hashlock: felt252,
        withdrawal_time: u64,
        public_withdrawal_time: u64,
        cancellation_time: u64,
        public_cancellation_time: u64,
    }

    #[derive(Drop, starknet::Event)]
    struct Claimed {
        swap_id: felt252,
        claimer: ContractAddress,
        preimage: felt252,
    }

    #[derive(Drop, starknet::Event)]
    struct Cancelled {
        swap_id: felt252,
        caller: ContractAddress,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    enum Event {
        Locked: Locked,
        Claimed: Claimed,
        Cancelled: Cancelled,
    }
    // ----------------------
    // External: lock
    // ----------------------
    #[external(v0)]
    fn lock(
        ref self: ContractState,
        swap_id: felt252,
        maker: ContractAddress,  // STRK user's address
        taker: ContractAddress,  // STRK Resolver 
        token: ContractAddress,
        amount: u256,
        hashlock: felt252, // poseidon(preimage)
        withdrawalTimeLock: u64,
        publicWithdrawalTimeLock: u64,
        cancellationTimeLock: u64,
        publicCancellationTimeLock: u64
        
    ) {
        let caller = get_caller_address();
        assert(caller == taker, 'only taker can lock');

        // Ensure swap_id not already used
        let existing_maker = self.maker.read(swap_id);
        assert(existing_maker == 0.try_into().unwrap(), 'swap exists');

        // Basic checks
        assert(maker != 0.try_into().unwrap(), 'zero maker');
        assert(taker != 0.try_into().unwrap(), 'zero taker');
        assert(amount > 0_u256.into(), 'zero amount');

        // Time sanity checks
        assert(withdrawalTimeLock < publicWithdrawalTimeLock, 'invalid time order');
        assert(publicWithdrawalTimeLock < cancellationTimeLock, 'invalid time order');
        assert(cancellationTimeLock < publicCancellationTimeLock, 'invalid time order');

        // Transfer ERC20 tokens from taker → escrow contract
        if token != 0.try_into().unwrap() {
            let this_addr: ContractAddress = get_contract_address();
            let erc20 = IERC20Dispatcher { contract_address: token };
            erc20.transfer_from(caller, this_addr, amount);
        } else {
            panic!("native token not supported");
        }

        // save state
        self.maker.write(swap_id, maker);
        self.taker.write(swap_id, taker);
        self.token.write(swap_id, token);
        self.amount.write(swap_id, amount);
        self.hashlock.write(swap_id, hashlock);
        self.claimed.write(swap_id, false);
        self.cancelled.write(swap_id, false);

        self.withdrawalTimeLock.write(swap_id, withdrawalTimeLock);
        self.publicWithdrawalTimeLock.write(swap_id, publicWithdrawalTimeLock);
        self.cancellationTimeLock.write(swap_id, cancellationTimeLock);
        self.publicCancellationTimeLock.write(swap_id, publicCancellationTimeLock);

        self.emit(Event::Locked(Locked {
            swap_id,
            maker,
            taker,
            token,
            amount,
            hashlock,
            withdrawal_time: withdrawalTimeLock,
            public_withdrawal_time: publicWithdrawalTimeLock,
            cancellation_time: cancellationTimeLock,
            public_cancellation_time: publicCancellationTimeLock,
        }));
    }

    // Claim funds: verifies preimage/hash and transfers tokens
    #[external(v0)]
    fn claim(ref self: ContractState, swap_id: felt252, preimage: felt252) {
        let caller = get_caller_address();
        let now = get_block_timestamp();

        let taker = self.taker.read(swap_id);
        let withdrawalTimeLock = self.withdrawalTimeLock.read(swap_id);
        let publicWithdrawalTimeLock = self.publicWithdrawalTimeLock.read(swap_id);
        let cancellationTimeLock = self.cancellationTimeLock.read(swap_id);

        // disallow claim after cancellation has started
        assert(now < cancellationTimeLock, 'too late, cancellation started');
        
        // withdraw allowed only in withdraw timeframe
        assert(now >= withdrawalTimeLock, 'too early for withdrawal');

        // only taker can claim in early window
        if now < publicWithdrawalTimeLock {
            assert(caller == taker, 'only taker can private claim');
        }

        let stored_hash = self.hashlock.read(swap_id);
        let poseidon_hash = PoseidonTrait::new().update(preimage).finalize();
        assert(stored_hash == poseidon_hash, 'invalid preimage'); 

        let is_claimed = self.claimed.read(swap_id);
        assert(!is_claimed, 'already claimed');

        self.claimed.write(swap_id, true);

        // read token,amount & transfer tokens
        let token = self.token.read(swap_id);
        let amount = self.amount.read(swap_id);

        // Pay out to taker (resolver)
        let erc20 = IERC20Dispatcher { contract_address: token };
        erc20.transfer(taker, amount);

        self.emit(Event::Claimed(Claimed { swap_id, claimer: caller, preimage }));
    }

    // cancel by taker after timelock
    #[external(v0)]
    fn cancel(ref self: ContractState, swap_id: felt252) {

        let caller = get_caller_address();
        let now = get_block_timestamp();

        let cancellationTimeLock = self.cancellationTimeLock.read(swap_id);
        let publicCancellationTimeLock = self.publicCancellationTimeLock.read(swap_id);
        let maker = self.maker.read(swap_id);

        assert(now >= cancellationTimeLock, 'too early to cancel');
        
        // Only maker can cancel before public window
        if now < publicCancellationTimeLock {
            assert(caller == maker, 'only maker can private cancel ');
        }

        // not already cancelled/refunded
        let is_cancelled = self.cancelled.read(swap_id);
        assert(!is_cancelled, 'already refunded');

        self.cancelled.write(swap_id, true);

        // transfer token back to maker
        let token = self.token.read(swap_id);
        let amount = self.amount.read(swap_id);

        let erc20 = IERC20Dispatcher { contract_address: token };
        erc20.transfer(maker, amount);

        self.emit(Event::Cancelled(Cancelled { swap_id, caller }));
    }


    // ----------------------
    // View helper
    // ----------------------
    #[external(v0)]
    fn get_swap(
        self: @ContractState,
        swap_id: felt252,
    ) -> (ContractAddress, ContractAddress, ContractAddress, u256, felt252, bool, bool, u64, u64, u64, u64) {
        let maker = self.maker.read(swap_id);
        let taker = self.taker.read(swap_id);
        let token = self.token.read(swap_id);
        let amount = self.amount.read(swap_id);
        let hashlock = self.hashlock.read(swap_id);
        let claimed = self.claimed.read(swap_id);
        let cancelled = self.cancelled.read(swap_id);
        let withdrawalTimeLock = self.withdrawalTimeLock.read(swap_id);
        let publicWithdrawalTimeLock = self.publicWithdrawalTimeLock.read(swap_id);
        let cancellationTimeLock = self.cancellationTimeLock.read(swap_id);
        let publicCancellationTimeLock = self.publicCancellationTimeLock.read(swap_id);


        (maker, taker, token, amount, hashlock, claimed, cancelled, withdrawalTimeLock, publicWithdrawalTimeLock, cancellationTimeLock, publicCancellationTimeLock)
    }
}