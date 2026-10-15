const googleTrends = require('google-trends-api');

async function getDemandTrend(keyword) {
    try {
        console.log(`[TrendService] Fetching Google Trends for keyword: "${keyword}"`);
        const results = await googleTrends.interestOverTime({
            keyword: keyword,
            startTime: new Date(Date.now() - (5 * 365 * 24 * 60 * 60 * 1000)), // Last 5 years
        });

        const data = JSON.parse(results);
        const timelineData = data.default?.timelineData || [];

        if (timelineData.length === 0) {
            return { keyword, trendDirection: "unknown", summary: "Not enough search volume data to determine a trend." };
        }

        // Simplify data: get average interest per year to see the trend
        const yearlyAverages = {};
        timelineData.forEach(point => {
            const year = new Date(point.time * 1000).getFullYear();
            if (!yearlyAverages[year]) {
                yearlyAverages[year] = { sum: 0, count: 0 };
            }
            yearlyAverages[year].sum += point.value[0];
            yearlyAverages[year].count += 1;
        });

        const summary = [];
        let previousAvg = null;
        let trendDirection = "flat";

        Object.keys(yearlyAverages).sort().forEach(year => {
            const avg = Math.round(yearlyAverages[year].sum / yearlyAverages[year].count);
            summary.push(`${year}: ~${avg}/100 interest`);

            if (previousAvg !== null) {
                if (avg > previousAvg + 10) trendDirection = "growing";
                else if (avg < previousAvg - 10) trendDirection = "declining";
            }
            previousAvg = avg;
        });

        return {
            keyword,
            trendDirection,
            summary: summary.join(" | ")
        };
    } catch (error) {
        console.error("[TrendService] Error fetching trends:", error);
        return { keyword, trendDirection: "unknown", summary: "Failed to fetch trend data." };
    }
}

module.exports = { getDemandTrend };
