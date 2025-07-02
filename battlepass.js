/**
 * Calculates XP requirements for battle pass levels in a balanced way.
 * @param {number} dailyXpGain - Average XP a player earns per day.
 * @param {number} baseDaysPerLevel - Target days required to complete the first level.
 * @param {number} growth - Percentage increase in days per level.
 * @returns {function(number): number} XP requirement function for a given level.
 */
function createBattlePassCalculator(dailyXpGain, baseDaysPerLevel = 2, growth = 0.1) {
    return function xpForLevel(level) {
        if (level <= 0) return 0;
        const days = baseDaysPerLevel * Math.pow(1 + growth, level - 1);
        return Math.round(days * dailyXpGain);
    };
}

module.exports = { createBattlePassCalculator };

// Example usage:
if (require.main === module) {
    const calculator = createBattlePassCalculator(600, 2, 0.1);
    for (let level = 1; level <= 5; level++) {
        console.log(`Level ${level}: ${calculator(level)} XP`);
    }
}
