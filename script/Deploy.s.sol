// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "forge-std/console.sol";

// FUTURES
import "../contracts/FuturesBook.sol";
import "../contracts/LinearFiniteFutures.sol";
import "../contracts/PowerFiniteFutures.sol";
import "../contracts/SigmoidFiniteFutures.sol";

contract DeployFuturesContracts is Script {
    function run() external {
        // Optional: load private key
        // uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        // vm.startBroadcast(deployerPrivateKey);

        vm.startBroadcast();

        // ===== FUTURES DEPLOYMENT =====
        LinearFiniteFutures  linearImpl  = new LinearFiniteFutures();
        PowerFiniteFutures   powerImpl   = new PowerFiniteFutures();
        SigmoidFiniteFutures sigmoidImpl = new SigmoidFiniteFutures();

        // NOTE: FuturesBook now expects THREE impl addresses (linear, power, sigmoid)
        FuturesBook futuresBook = new FuturesBook(
            address(linearImpl),
            address(powerImpl),
            address(sigmoidImpl)
        );

        vm.stopBroadcast();

        console.log("LinearFiniteFutures  Impl: ", address(linearImpl));
        console.log("PowerFiniteFutures   Impl: ", address(powerImpl));
        console.log("SigmoidFiniteFutures Impl: ", address(sigmoidImpl));
        console.log("FuturesBook Factory:       ", address(futuresBook));

        // Quick sanity: ensure wiring is correct
        require(futuresBook.futuresImpl()        == address(linearImpl),  "Book wired to wrong linear impl");
        require(futuresBook.powerFuturesImpl()   == address(powerImpl),   "Book wired to wrong power impl");
        require(futuresBook.sigmoidFuturesImpl() == address(sigmoidImpl), "Book wired to wrong sigmoid impl");
    }
}
