"use client";

import React, { useMemo } from "react";
import { COLORS } from "@/lib/colors";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
} from "recharts";

/**
 * OptionPayoffChart
 * Minimalist payoff chart for DDX Protocol options.
 *
 * Tech: Recharts, Tailwind, dark theme friendly.
 */

export type OptionType = "CALL" | "PUT";
export type PayoffType = "Linear" | "Quadratic" | "Logarithmic" | "Power" | "Sigmoid" | "Sinusoidal";

export type OptionPayoffChartProps = {
  optionType: OptionType;
  payoffType: PayoffType;
  /** Strings in on-chain units (wei-like). */
  strikePrice: string; // e.g., "1000000000000000000"
  optionSize: string; // position size multiplier (same units as underlying)
  /** Symbols for labels */
  strikeSymbol?: string; // e.g., "MTK"
  underlyingSymbol?: string; // e.g., "2TK"
  /** Optional current spot price to display as a marker (same units). */
  currentSpotPrice?: string;
  /**
   * Decimals for unit conversion from on-chain to display (default 18).
   */
  decimals?: number;
  /** Range around strike for X axis as a fraction of strike (default 1.0 => ±100%). */
  rangeFraction?: number;
  /** Number of points to sample for the curve. */
  resolution?: number;
  /** Optional className for outer wrapper */
  className?: string;
  /** Use compact margins for smaller charts */
  compact?: boolean;
  /** Show short position perspective with inverted payoff and different styling */
  isShortPosition?: boolean;
  /** Show neutral perspective with neon pink for non-user contracts */
  isNonUserContract?: boolean;
  /** For futures contracts - changes diagonal line behavior */
  isFuturesContract?: boolean;
  /** For genie contracts - changes color scheme */
  isGenieContract?: boolean;
  /** Power for Power payoff type (default 2) */
  payoffPower?: number;
  /** Intensity for Sigmoid payoff type (default 1.0) */
  sigmoidIntensity?: number;
  /** Amplitude for Sinusoidal payoff type (default 1.0) */
  sinusoidalAmplitude?: number;
  /** Period for Sinusoidal payoff type (default strike price) */
  sinusoidalPeriod?: number;
};

const NEON_GREEN = COLORS.LONG; // neon green payoff line for long positions
const NEON_ORANGE = COLORS.SHORT; // neon orange
const NEON_PINK = COLORS.NEUTRAL_OPTIONS; // neon pink payoff line for non-user contracts (options)
const NEON_INDIGO = COLORS.NEUTRAL; // indigo for futures contracts
const NEON_CYAN = COLORS.NEUTRAL_GENIES; // cyan for genie contracts
const GRID_COLOR = "hsl(var(--border) / 0.25)"; // subtle grid per design system
// Use theme-aware colors that work in both light and dark modes
const AXIS_COLOR = "rgb(229 231 235)"; // gray-200 for light backgrounds, visible on dark
const LABEL_COLOR = "rgb(229 231 235)"; // gray-200, visible in both themes

function fromUnits(value: string | undefined, decimals = 18): number | undefined {
  if (value == null) return undefined;
  try {
    // Support big ints safely by using BigInt when possible
    const bi = BigInt(value);
    const base = 10n ** BigInt(decimals);
    const whole = Number(bi / base);
    const frac = Number(bi % base) / Number(base);
    const result = whole + frac;
    if (!Number.isFinite(result)) {
      console.warn('fromUnits produced NaN/Infinity:', { value, decimals, result });
      return undefined;
    }
    return result;
  } catch (error) {
    // Fallback for plain decimal strings
    console.warn('fromUnits BigInt failed, trying Number:', { value, error });
    const num = Number(value);
    if (!Number.isFinite(num)) {
      console.warn('fromUnits Number conversion failed:', { value, num });
      return undefined;
    }
    return num;
  }
}

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

function payoff(
  payoffType: PayoffType,
  optionType: OptionType,
  spotPrice: number,
  K: number,
  power: number = 2,
  intensity: number = 1.0,
  amplitude: number = 1.0,
  period: number = K
): number {
  switch (payoffType) {
    case "Linear":
      const d = optionType === "CALL" ? Math.max(0, spotPrice - K) : Math.max(0, K - spotPrice);
      return d;
    case "Quadratic":
      const d2 = optionType === "CALL" ? Math.max(0, spotPrice - K) : Math.max(0, K - spotPrice);
      return d2 * d2;
    case "Power":
      const diff = Math.abs(spotPrice - K);
      return Math.pow(diff, power);
    case "Sigmoid":
      // Sigmoid payoff: |sigmoid(I*(S-K)) - 0.5| * 2 * notional
      // For futures: notional = K (strike price as it represents the contract value)
      const z = intensity * (spotPrice - K);
      const sigmoidValue = sigmoid(z);
      const delta = Math.abs(sigmoidValue - 0.5);
      return delta * 2 * K; // Using K as notional for display purposes
    case "Sinusoidal":
      // Sinusoidal payoff exactly matching SinusoidalGenie.sol contract
      // notional = strikePrice * positionSize (but for display we use K as notional)
      const notional = K; // Using strike price as notional for display
      const priceDiff = spotPrice - K; // diff = int256(p1) - int256(p0)
      const angle = (priceDiff * 2 * Math.PI) / period; // angle = ((diff * TWO_PI) / int256(period1e18))
      const sinVal = Math.sin(angle); // sinVal in [-1, +1]
      const scaled = sinVal * amplitude; // scaled = (sinVal * amplitude) / 1e18 -> [-A, +A]
      const ratio = (1 + scaled) / 2; // ratio1e18 = (scaled + 1e18) / 2 -> [0, 1] fraction
      // Clamp ratio to [0, 1] just like the contract
      const clampedRatio = Math.max(0, Math.min(1, ratio));
      return clampedRatio * notional; // payout = (ratio * notional) / 1e18
    case "Logarithmic":
      if (optionType === "CALL") {
        // Logarithmic Call Beta Variant: P = S * log(I(x-K + 1/I)) if x >= K, else 0
        // Normalized per unit: log(I(x-K + 1/I))
        const I = 10;
        console.log(`Log Call Beta Debug: spotPrice=${spotPrice}, K=${K}, I=${I}, condition=${spotPrice >= K}`);
        if (spotPrice >= K) {
          const argument = I * (spotPrice - K + 1/I);
          const logValue = Math.log(argument);
          console.log(`Log Call Beta: log(${I} * (${spotPrice} - ${K} + ${1/I})) = log(${argument}) = ${logValue}`);
          return logValue;
        }
        return 0;
      } else {
        // Logarithmic Put Beta Variant: P = S * log(I(K-x + 1/I)) if x <= K, else 0
        // Normalized per unit: log(I(K-x + 1/I))
        const I = 10;
        console.log(`Log Put Beta Debug: spotPrice=${spotPrice}, K=${K}, I=${I}, condition=${spotPrice <= K}`);
        if (spotPrice <= K) {
          const argument = I * (K - spotPrice + 1/I);
          const logValue = Math.log(argument);
          console.log(`Log Put Beta: log(${I} * (${K} - ${spotPrice} + ${1/I})) = log(${argument}) = ${logValue}`);
          return logValue;
        }
        return 0;
      }
    default:
      const dDefault = optionType === "CALL" ? Math.max(0, spotPrice - K) : Math.max(0, K - spotPrice);
      return dDefault;
  }
}

function formatNumber(n: number, maxFrac = 4) {
  try {
    return new Intl.NumberFormat(undefined, {
      maximumFractionDigits: maxFrac,
    }).format(n);
  } catch {
    return String(Math.round(n * 10 ** maxFrac) / 10 ** maxFrac);
  }
}

export default function OptionPayoffChart(props: OptionPayoffChartProps) {
  const {
    optionType,
    payoffType,
    strikePrice,
    optionSize,
    strikeSymbol = "",
    underlyingSymbol = "",
    currentSpotPrice,
    decimals = 18,
    rangeFraction = 1.0,
    resolution = 120,
    className,
    compact = false,
    isShortPosition = false,
    isNonUserContract = false,
    isFuturesContract = false,
    isGenieContract = false,
    payoffPower = 2,
    sigmoidIntensity = 1.0,
    sinusoidalAmplitude = 1.0,
    sinusoidalPeriod,
  } = props;

  const K = fromUnits(strikePrice, decimals) ?? 0;
  const size = fromUnits(optionSize, decimals) ?? 1;
  const S_curr = fromUnits(currentSpotPrice, decimals);

  const [minX, maxX] = useMemo(() => {
    // Center around strike; expand if current spot is far
    const baseMin = Math.max(0, K * (1 - rangeFraction));
    const baseMax = K * (1 + rangeFraction);
    if (S_curr == null) return [baseMin, baseMax];
    let min = Math.min(baseMin, Math.min(S_curr, K) * 0.8);
    let max = Math.max(baseMax, Math.max(S_curr, K) * 1.2);
    // ensure positive span
    if (max - min < 1e-9) {
      min = Math.max(0, K * 0.5);
      max = K * 1.5;
    }
    return [min, max];
  }, [K, rangeFraction, S_curr]);

  const data = useMemo(() => {
    // Guard against NaN values
    if (!Number.isFinite(minX) || !Number.isFinite(maxX) || !Number.isFinite(K) || !Number.isFinite(size)) {
      return [];
    }
    
    const pts = Math.max(16, Math.min(500, Math.floor(resolution)));
    const out: { spot: number; payoff: number; diagonal?: number }[] = [];
    const span = maxX - minX || 1;
    for (let i = 0; i < pts; i++) {
      const t = i / (pts - 1);
      const S = minX + t * span;
      let value;
      if (isFuturesContract) {
        // For futures contracts: use futures payoff logic
        if (payoffType === 'Power') {
          // Power Futures: Asymmetric directional payoffs
          if (isShortPosition) {
            // Short perspective: win when S < K, lose when S > K
            if (S < K) {
              value = Math.pow(K - S, payoffPower) * size; // Profit when price goes down
            } else if (S > K) {
              value = -Math.pow(S - K, payoffPower) * size; // Loss when price goes up
            } else {
              value = 0; // No change at strike
            }
          } else {
            // Long perspective: win when S > K, lose when S < K  
            if (S > K) {
              value = Math.pow(S - K, payoffPower) * size; // Profit when price goes up
            } else if (S < K) {
              value = -Math.pow(K - S, payoffPower) * size; // Loss when price goes down
            } else {
              value = 0; // No change at strike
            }
          }
        } else if (payoffType === 'Sigmoid') {
          // Sigmoid Futures: Asymmetric directional sigmoid payoffs
          const z = sigmoidIntensity * (S - K);
          const sigmoidValue = sigmoid(z);
          const delta = Math.abs(sigmoidValue - 0.5);
          const sigmoidPayoff = delta * 2 * K * size; // K represents notional
          
          if (isShortPosition) {
            // Short wins when S < K, loses when S > K
            if (S < K) {
              value = sigmoidPayoff; // Profit
            } else if (S > K) {
              value = -sigmoidPayoff; // Loss  
            } else {
              value = 0; // No change at strike
            }
          } else {
            // Long wins when S > K, loses when S < K
            if (S > K) {
              value = sigmoidPayoff; // Profit
            } else if (S < K) {
              value = -sigmoidPayoff; // Loss
            } else {
              value = 0; // No change at strike
            }
          }
        } else if (payoffType === 'Sinusoidal') {
          // Sinusoidal Genie: Directional payoff like Power/Sigmoid futures
          const notional = K * size; // notional = strikePrice * positionSize
          const priceDiff = S - K; // diff = int256(p1) - int256(p0)
          const angle = (priceDiff * 2 * Math.PI) / (sinusoidalPeriod || K); // angle = ((diff * TWO_PI) / int256(period1e18))
          const sinVal = Math.sin(angle); // sinVal in [-1, +1] - this is the directional component
          const scaled = sinVal * (sinusoidalAmplitude || 1.0); // scaled = (sinVal * amplitude) -> [-A, +A]
          
          // For display purposes, show the directional nature of the sine wave
          // Positive sine = long wins, negative sine = short wins
          const sinusoidalPayoff = Math.abs(scaled) * notional / 2; // Magnitude of the payoff
          
          if (isShortPosition) {
            // Short wins when sine is negative, loses when sine is positive
            if (scaled < 0) {
              value = sinusoidalPayoff; // Profit when sine is negative
            } else if (scaled > 0) {
              value = -sinusoidalPayoff; // Loss when sine is positive
            } else {
              value = 0; // Neutral at zero crossing
            }
          } else {
            // Long wins when sine is positive, loses when sine is negative
            if (scaled > 0) {
              value = sinusoidalPayoff; // Profit when sine is positive
            } else if (scaled < 0) {
              value = -sinusoidalPayoff; // Loss when sine is negative
            } else {
              value = 0; // Neutral at zero crossing
            }
          }
        } else {
          // Linear futures: y = (S - K) * size
          value = (S - K) * size;
        }
      } else {
        // For options contracts: use option payoff logic
        value = payoff(payoffType, optionType, S, K, payoffPower, sigmoidIntensity, sinusoidalAmplitude, sinusoidalPeriod || K) * size; // Total payoff (not normalized)
      }
      
      // For short positions, invert the payoff to show the seller's perspective
      // (Skip this for Power, Sigmoid, and Sinusoidal futures as they handle position perspective internally)
      if (isShortPosition && !(isFuturesContract && (payoffType === 'Power' || payoffType === 'Sigmoid' || payoffType === 'Sinusoidal'))) {
        value = -value;
      }
      
      // Guard against NaN in calculated values
      if (Number.isFinite(S) && Number.isFinite(value)) {
        let diagonalValue;
        
        if (isFuturesContract) {
          // For futures: y = x - K (long) or y = -(x - K) (short)
          const futuresValue = (S - K) * size;
          diagonalValue = isShortPosition ? -futuresValue : futuresValue;
        } else {
          // For options: maintain original behavior
          diagonalValue = optionType === "CALL" ? (S >= K ? (S - K) * size : undefined) : (S <= K ? (K - S) * size : undefined);
          // Also invert diagonal for short positions
          if (isShortPosition && diagonalValue !== undefined) {
            diagonalValue = -diagonalValue;
          }
        }
        
        out.push({ 
          spot: S, 
          payoff: value,
          diagonal: diagonalValue
        });
      }
    }
    return out;
  }, [minX, maxX, payoffType, optionType, K, resolution, size, isShortPosition, isFuturesContract, payoffPower]);

  const [yMin, yMax] = useMemo(() => {
    // Determine reasonable Y bounds for nice padding, handling negative values for short positions
    let min = 0;
    let max = 0;
    for (const d of data) {
      min = Math.min(min, d.payoff);
      max = Math.max(max, d.payoff);
    }
    
    if (isShortPosition) {
      // For short positions, we want to show negative values, so extend the range appropriately
      if (!Number.isFinite(min) || min >= 0) min = -1; // ensure we have negative space
      if (!Number.isFinite(max) || max <= 0) max = 0.1; // small positive space for labels
      return [min * 1.3, max * 1.3];
    } else {
      // For long positions, keep the original behavior
      if (!Number.isFinite(max) || max <= 0) max = 1; // avoid zero height
      return [0, max * 1.3];
    }
  }, [data, isShortPosition]);

  const axisLabelX = `Spot Price${underlyingSymbol ? ` (${underlyingSymbol})` : ""}`;
  const axisLabelY = `Total Payoff${strikeSymbol ? ` (${strikeSymbol})` : ""}`;

  // Don't render chart if we have invalid data
  if (!Number.isFinite(K) || !Number.isFinite(size) || !Number.isFinite(minX) || !Number.isFinite(maxX) || data.length === 0) {
    return (
      <div className="w-full h-32 flex items-center justify-center text-muted-foreground">
        <span>Chart data unavailable</span>
      </div>
    );
  }

  return (
    <div
      className={
        className?.includes('h-') 
          ? `w-full transition-all duration-300 rounded-lg bg-transparent ${className}`
          : `w-full h-72 md:h-96 transition-all duration-300 rounded-lg bg-transparent ${className ?? ""}`
      }
    >
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={compact ? { top: 20, right: 4, left: -40, bottom: 24 } : { top: 32, right: 16, left: 48, bottom: 32 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} />
          <XAxis
            dataKey="spot"
            type="number"
            domain={[Number.isFinite(minX) ? minX : 0, Number.isFinite(maxX) ? maxX : 1]}
            tick={{ fill: AXIS_COLOR, fontSize: 12 }}
            axisLine={{ stroke: GRID_COLOR }}
            tickLine={{ stroke: GRID_COLOR }}
            tickFormatter={(v) => formatNumber(v)}
            label={{ 
              value: axisLabelX, 
              position: isShortPosition ? "insideBottom" : "insideBottom", 
              offset: -15, 
              fill: LABEL_COLOR 
            }}
          />
          <YAxis
            domain={[yMin, yMax]}
            tick={compact ? false : { fill: AXIS_COLOR, fontSize: 12 }}
            axisLine={compact ? false : { stroke: GRID_COLOR }}
            tickLine={compact ? false : { stroke: GRID_COLOR }}
            tickFormatter={compact ? () => '' : (v) => formatNumber(v)}
            tickCount={6}
            label={compact ? undefined : { 
              value: axisLabelY, 
              angle: -90, 
              position: "insideLeft", 
              style: { textAnchor: "middle" },
              offset: 10,
              fill: LABEL_COLOR 
            }}
          />

          {/* Strike price vertical line (y-axis at strike) - always visible */}
          {Number.isFinite(K) && (
            <ReferenceLine 
              x={K} 
              stroke="#666666" 
              strokeWidth={1}
              strokeDasharray="1 1"
              label={{
                value: "Strike",
                position: isShortPosition ? "top" : "top",
                fill: LABEL_COLOR,
                fontSize: 12,
              }} 
            />
          )}

          {/* Y=X diagonal reference line as actual data */}
          <Line
            type="monotone"
            dataKey="diagonal"
            dot={false}
            strokeWidth={1}
            stroke="#555555"
            strokeDasharray="5 5"
            strokeOpacity={0.4}
          />

          {/* Current spot price marker */}
          {S_curr != null && Number.isFinite(S_curr) && (
            <ReferenceLine
              x={S_curr}
              stroke="hsl(var(--accent))"
              strokeDasharray="2 2"
              label={{
                value: `Spot ${formatNumber(S_curr)}`,
                position: "bottom",
                fill: LABEL_COLOR,
                fontSize: 12,
              }}
            />
          )}

          <Tooltip
            contentStyle={{
              background: "hsl(var(--card))",
              border: "1px solid hsl(var(--border))",
              borderRadius: 8,
            }}
            labelStyle={{ color: "rgb(229 231 235)" }}
            formatter={(val: any, _name, ctx) => {
              if (ctx && typeof ctx.payload?.spot === "number") {
                return [formatNumber(Number(val)), "Payoff"];
              }
              return [val, "Payoff"];
            }}
            labelFormatter={(label) => `${axisLabelX}: ${formatNumber(Number(label))}`}
          />

          <Line
            type="monotone"
            dataKey="payoff"
            dot={false}
            strokeWidth={2.5}
            stroke={
              isNonUserContract 
                ? (isGenieContract ? NEON_CYAN : isFuturesContract ? NEON_INDIGO : NEON_PINK) 
                : (isShortPosition ? NEON_ORANGE : NEON_GREEN)
            }
            className="transition-all duration-300"
            isAnimationActive
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}