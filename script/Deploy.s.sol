// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "forge-std/console.sol";

// FUTURES
import "../contracts/FuturesBook.sol";
import "../contracts/LinearFiniteFutures.sol";
import "../contracts/PowerFiniteFutures.sol";

// // OPTIONS (commented out)
// import "../contracts/CallOptionContract.sol";
// import "../contracts/PutOptionContract.sol";
// import "../contracts/QuadraticCallOption.sol";
// import "../contracts/QuadraticPutOption.sol";
// import "../contracts/LogarithmicCallOption.sol";
// import "../contracts/LogarithmicPutOption.sol";
// import "../contracts/OptionsBook.sol";

contract DeployFuturesContracts is Script {
    function run() external {
        // Optional: load private key from env if you want a specific deployer
        // uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        // vm.startBroadcast(deployerPrivateKey);

        vm.startBroadcast();

        // ===== FUTURES DEPLOYMENT =====
        LinearFiniteFutures linearImpl = new LinearFiniteFutures();
        PowerFiniteFutures  powerImpl  = new PowerFiniteFutures();

        // NOTE: FuturesBook now expects BOTH impl addresses (linear, power)
        FuturesBook futuresBook = new FuturesBook(
            address(linearImpl),
            address(powerImpl)
        );

        vm.stopBroadcast();

        console.log("LinearFiniteFutures Impl: ", address(linearImpl));
        console.log("PowerFiniteFutures  Impl: ", address(powerImpl));
        console.log("FuturesBook Factory:      ", address(futuresBook));

        // Quick sanity (optional): ensure wiring is correct
        require(futuresBook.futuresImpl() == address(linearImpl), "Book wired to wrong linear impl");
        require(futuresBook.powerFuturesImpl() == address(powerImpl), "Book wired to wrong power impl");

        // ===== OPTIONS DEPLOYMENT (commented out) =====
//         // Deploy Linear Option implementations (existing)
//         CallOptionContract callImpl = new CallOptionContract();
//         PutOptionContract putImpl = new PutOptionContract();
//
//         // Deploy Quadratic Option implementations (new)
//         QuadraticCallOption quadraticCallImpl = new QuadraticCallOption();
//         QuadraticPutOption quadraticPutImpl = new QuadraticPutOption();
//
//         // Deploy Logarithmic Option implementations (new)
//         LogarithmicCallOption logarithmicCallImpl = new LogarithmicCallOption();
//         LogarithmicPutOption logarithmicPutImpl = new LogarithmicPutOption();
//
//         // Deploy the OptionsBook factory with all implementations
//         OptionsBook book = new OptionsBook(
//             address(callImpl),
//             address(putImpl),
//             address(quadraticCallImpl),
//             address(quadraticPutImpl),
//             address(logarithmicCallImpl),
//             address(logarithmicPutImpl)
//         );
//
//         console.log("CallOptionContract Impl:     ", address(callImpl));
//         console.log("PutOptionContract Impl:      ", address(putImpl));
//         console.log("QuadraticCallOption Impl:    ", address(quadraticCallImpl));
//         console.log("QuadraticPutOption Impl:     ", address(quadraticPutImpl));
//         console.log("LogarithmicCallOption Impl:  ", address(logarithmicCallImpl));
//         console.log("LogarithmicPutOption Impl:   ", address(logarithmicPutImpl));
//         console.log("OptionsBook Factory:         ", address(book));
    }
}
