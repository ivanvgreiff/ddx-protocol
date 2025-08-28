// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "forge-std/console.sol";

import "../contracts/GenieBook.sol";
import "../contracts/SinusoidalGenie.sol";

contract DeployGenieContracts is Script {
    function run() external {
        // Optional: load private key
        // uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        // vm.startBroadcast(deployerPrivateKey);

        vm.startBroadcast();

        // Deploy Sinusoidal Genie implementation
        SinusoidalGenie sinusoidalImpl = new SinusoidalGenie();

        // Polynomial placeholder can be zero for now
        GenieBook book = new GenieBook(address(sinusoidalImpl), address(0));

        vm.stopBroadcast();

        console.log("SinusoidalGenie Impl: ", address(sinusoidalImpl));
        console.log("GenieBook Factory:    ", address(book));

        // Sanity: ensure wiring is correct
        require(book.sinusoidalGenieImpl() == address(sinusoidalImpl), "Book wired to wrong sinusoidal impl");
        // polynomialGenieImpl is allowed to be zero at this stage
    }
}
