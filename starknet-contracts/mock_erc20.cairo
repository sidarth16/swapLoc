use starknet::ContractAddress;
use core::integer::u256;

/// ERC20 interface
#[starknet::interface]
pub trait IERC20<TContractState> {
    fn name(self: @TContractState) -> felt252;
    fn symbol(self: @TContractState) -> felt252;
    fn decimals(self: @TContractState) -> u8;
    fn total_supply(self: @TContractState) -> u256;
    fn balance_of(self: @TContractState, owner: ContractAddress) -> u256;
    fn allowance(self: @TContractState, owner: ContractAddress, spender: ContractAddress) -> u256;

    fn transfer(ref self: TContractState, to: ContractAddress, amount: u256);
    fn approve(ref self: TContractState, spender: ContractAddress, amount: u256);
    fn transfer_from(ref self: TContractState, owner: ContractAddress, to: ContractAddress, amount: u256);

    fn mint(ref self: TContractState, to: ContractAddress, amount: u256);
    fn burn(ref self: TContractState, from: ContractAddress, amount: u256);
}

#[starknet::contract]
mod MockERC20 {
    use starknet::ContractAddress;
    use starknet::storage::{
        Map,
        StoragePointerReadAccess,
        StoragePointerWriteAccess,
        StorageMapReadAccess,
        StorageMapWriteAccess,
    };
    use core::integer::u256;
    use core::traits::TryInto;

    #[storage]
    struct Storage {
        name: felt252,
        symbol: felt252,
        decimals: u8,
        total_supply: u256,
        balances: Map<ContractAddress, u256>,
        allowances: Map<(ContractAddress, ContractAddress), u256>,
    }

    #[constructor]
    fn constructor(ref self: ContractState, name: felt252, symbol: felt252, decimals: felt252) {
        self.name.write(name);
        self.symbol.write(symbol);

        let dec: u8 = decimals.try_into().unwrap();
        self.decimals.write(dec);

        self.total_supply.write(0);
    }

    #[abi(embed_v0)]
    impl ERC20Impl of super::IERC20<ContractState> {
        fn name(self: @ContractState) -> felt252 {
            self.name.read()
        }

        fn symbol(self: @ContractState) -> felt252 {
            self.symbol.read()
        }

        fn decimals(self: @ContractState) -> u8 {
            self.decimals.read()
        }

        fn total_supply(self: @ContractState) -> u256 {
            self.total_supply.read()
        }

        fn balance_of(self: @ContractState, owner: ContractAddress) -> u256 {
            self.balances.read(owner)
        }

        fn allowance(self: @ContractState, owner: ContractAddress, spender: ContractAddress) -> u256 {
            self.allowances.read((owner, spender))
        }

        fn transfer(ref self: ContractState, to: ContractAddress, amount: u256) {
            assert(amount != 0, 'Transfer amount cannot be 0');
            let caller = starknet::get_caller_address();
            let sender_balance = self.balances.read(caller);
            assert(sender_balance >= amount, 'Insufficient balance');

            self.balances.write(caller, sender_balance - amount);
            self.balances.write(to, self.balances.read(to) + amount);
        }

        fn approve(ref self: ContractState, spender: ContractAddress, amount: u256) {
            let caller = starknet::get_caller_address();
            self.allowances.write((caller, spender), amount);
        }

        fn transfer_from(ref self: ContractState, owner: ContractAddress, to: ContractAddress, amount: u256) {
            assert(amount != 0, 'Transfer amount cannot be 0');
            let caller = starknet::get_caller_address();
            let allowance = self.allowances.read((owner, caller));
            assert(allowance >= amount, 'Allowance exceeded');

            let owner_balance = self.balances.read(owner);
            assert(owner_balance >= amount, 'Owner balance too low');

            self.allowances.write((owner, caller), allowance - amount);
            self.balances.write(owner, owner_balance - amount);
            self.balances.write(to, self.balances.read(to) + amount);
        }

        fn mint(ref self: ContractState, to: ContractAddress, amount: u256) {
            assert(amount != 0, 'Mint amount cannot be 0');
            self.total_supply.write(self.total_supply.read() + amount);
            self.balances.write(to, self.balances.read(to) + amount);
        }

        fn burn(ref self: ContractState, from: ContractAddress, amount: u256) {
            assert(amount != 0, 'Burn amount cannot be 0');
            let balance = self.balances.read(from);
            assert(balance >= amount, 'Burn exceeds balance');

            self.balances.write(from, balance - amount);
            self.total_supply.write(self.total_supply.read() - amount);
        }
    }
}
