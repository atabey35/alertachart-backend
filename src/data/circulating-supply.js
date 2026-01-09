/**
 * Circulating Supply Data for Top Coins
 * 
 * Bu veri manuel olarak güncellenir (haftalık/aylık)
 * Kaynak: CoinGecko API (bir kez çekilip hardcode edildi)
 * Son güncelleme: 2026-01-08
 * 
 * Format: Symbol → Circulating Supply
 * Not: Binance'de XXXUSDT formatında trade edilir
 */

export const CIRCULATING_SUPPLY = {
    // Top 10 (TOTAL hesaplaması için)
    BTC: 19_600_000,
    ETH: 120_270_000,
    USDT: 91_000_000_000, // Stablecoin - market cap'e dahil edilmeyecek
    BNB: 153_856_150,
    SOL: 441_000_000,
    XRP: 54_000_000_000,
    USDC: 42_000_000_000, // Stablecoin - market cap'e dahil edilmeyecek
    ADA: 35_000_000_000,
    DOGE: 143_000_000_000,
    AVAX: 395_000_000,

    // 11-25
    TRX: 86_700_000_000,
    DOT: 1_400_000_000,
    LINK: 608_000_000,
    MATIC: 10_000_000_000, // POL
    TON: 5_100_000_000,
    SHIB: 589_000_000_000_000, // Very large supply
    LTC: 74_000_000,
    BCH: 19_600_000,
    UNI: 600_000_000,
    ATOM: 390_000_000,
    XLM: 29_500_000_000,
    ETC: 147_000_000,
    XMR: 18_400_000,
    FIL: 540_000_000,
    APT: 480_000_000,

    // 26-50
    NEAR: 1_100_000_000,
    INJ: 93_000_000,
    OP: 1_100_000_000,
    ARB: 3_600_000_000,
    IMX: 1_600_000_000,
    RUNE: 340_000_000,
    STX: 1_450_000_000,
    ALGO: 8_200_000_000,
    MKR: 900_000,
    AAVE: 15_000_000,
    GRT: 9_500_000_000,
    SAND: 2_300_000_000,
    MANA: 1_900_000_000,
    AXS: 148_000_000,
    THETA: 1_000_000_000,
    EGLD: 26_500_000,
    FTM: 2_800_000_000,
    FLOW: 1_500_000_000,
    KAVA: 1_050_000_000,
    CAKE: 390_000_000,

    // 51-75
    CHZ: 8_900_000_000,
    LDO: 890_000_000,
    CRV: 1_200_000_000,
    APE: 370_000_000,
    GALA: 36_000_000_000,
    BLUR: 2_600_000_000,
    DYDX: 640_000_000,
    FET: 2_600_000_000,
    AGIX: 1_200_000_000,
    OCEAN: 1_400_000_000,
    RNDR: 390_000_000,
    WOO: 1_650_000_000,
    ZRX: 850_000_000,
    SNX: 330_000_000,
    ENJ: 1_000_000_000,

    // 76-100
    ONE: 14_000_000_000,
    ROSE: 6_700_000_000,
    CELO: 550_000_000,
    ANKR: 10_000_000_000,
    IOTX: 9_500_000_000,
    SKL: 5_000_000_000,
    BAT: 1_500_000_000,
    ZIL: 18_500_000_000,
    ENS: 32_000_000,
    COMP: 10_000_000,
    YFI: 36_000,
    SUSHI: 260_000_000,
    CVC: 1_000_000_000,
    STORJ: 420_000_000,
    LRC: 1_400_000_000,
    BAND: 130_000_000,
    NMR: 11_000_000,
    REN: 1_000_000_000,
    KNC: 170_000_000,
    BAL: 67_000_000,

    // Meme Coins
    PEPE: 420_690_000_000_000,
    FLOKI: 9_700_000_000_000,
    WIF: 999_000_000,
    BONK: 93_000_000_000_000,

    // AI Coins
    TAO: 7_000_000,
    ARKM: 150_000_000,
    WLD: 580_000_000,

    // Gaming/Metaverse
    ILV: 3_000_000,
    MAGIC: 340_000_000,
    GMT: 6_000_000_000,

    // Layer 2
    STRK: 1_800_000_000,
    ZK: 3_600_000_000,
    MANTA: 1_000_000_000,
    SEI: 3_600_000_000,
    SUI: 2_700_000_000,
    TIA: 200_000_000,
};

// Stablecoins - Market cap hesaplamasının dışında tutulacak
export const STABLECOINS = ['USDT', 'USDC', 'BUSD', 'TUSD', 'DAI', 'FDUSD', 'USDP'];

// Top 10 coins (BTC dahil) - OTHERS hesaplaması için
export const TOP_10_SYMBOLS = ['BTC', 'ETH', 'BNB', 'SOL', 'XRP', 'ADA', 'DOGE', 'AVAX', 'TRX', 'DOT'];

// Market Cap Index çarpanları (TradingView verileriyle eşleşmesi için)
export const INDEX_MULTIPLIERS = {
    TOTAL: 1.172,
    TOTAL2: 1.500,
    OTHERS: 2.584,
};

export default CIRCULATING_SUPPLY;
