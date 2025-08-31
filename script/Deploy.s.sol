// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "forge-std/console.sol";

import "../contracts/core/GenieBook.sol";
import "../contracts/genies/SinusoidalGenie.sol";
import "../contracts/genies/hPolynomialGenie.sol";

contract DeployGenieContracts is Script {
    function run() external {
        // Optional: load private key
        // uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        // vm.startBroadcast(deployerPrivateKey);

        vm.startBroadcast();

        // 1) Deploy implementations
        SinusoidalGenie sinusoidalImpl = new SinusoidalGenie();
        PolynomialGenie polynomialImpl = new PolynomialGenie();

        // 2) Deploy the factory/book with both impls wired
        GenieBook book = new GenieBook(address(sinusoidalImpl), address(polynomialImpl));

        vm.stopBroadcast();

        // 3) Log addresses
        console.log("SinusoidalGenie Impl: ", address(sinusoidalImpl));
        console.log("PolynomialGenie Impl: ", address(polynomialImpl));
        console.log("GenieBook Factory:    ", address(book));

        // 4) Sanity checks
        require(book.sinusoidalGenieImpl() == address(sinusoidalImpl), "Book wired to wrong sinusoidal impl");
        require(book.polynomialGenieImpl() == address(polynomialImpl), "Book wired to wrong polynomial impl");
    }
}
