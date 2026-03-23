const express = require('express');
const db = require('../db/database');
const { authMiddleware } = require('../middleware/auth');
const {
    generateIdeas,
    generateStrategicDirections,
    expandIdea,
    analyzeIdeaBusinessBlueprint
} = require('../services/aiService');
const { checkIdeaViability } = require('../services/validationService');

const router = express.Router();

// POST /api/generate-ideas
router.post('/generate-ideas', authMiddleware, async (req, res) => {
    try {
        const { domain, skills, timeAvailable, budgetLevel, experienceLevel, targetUsers } = req.body;
        if (!domain) return res.status(400).json({ error: 'Domain is required' });

        const ideas = await generateIdeas(domain, skills, experienceLevel, targetUsers);

        // Save to DB
        const result = db.prepare(`
      INSERT INTO ideas (user_id, domain, skills, time_available, budget_level, experience_level, target_users, idea_data)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(req.user.id, domain, skills, timeAvailable, budgetLevel, experienceLevel, targetUsers || null, JSON.stringify(ideas));

        res.json({ ideaSessionId: result.lastInsertRowid, ideas });
    } catch (err) {
        console.error('Generate ideas error:', err);
        res.status(500).json({ error: err.message || 'Failed to generate ideas. Please try again.' });
    }
});

// POST /api/check-idea-viability
router.post('/check-idea-viability', authMiddleware, async (req, res) => {
    try {
        const { ideaSessionId, selectedIdea } = req.body;
        if (!ideaSessionId || !selectedIdea) {
            return res.status(400).json({ error: 'ideaSessionId and selectedIdea are required' });
        }

        const session = db.prepare('SELECT domain, target_users FROM ideas WHERE id = ? AND user_id = ?').get(ideaSessionId, req.user.id);
        if (!session) return res.status(404).json({ error: 'Idea session not found' });

        const viabilityResult = await checkIdeaViability(selectedIdea, session.domain, session.target_users);
        res.json({ ideaSessionId, viabilityResult });
    } catch (err) {
        console.error('Check idea viability error:', err);
        res.status(500).json({ error: err.message || 'Failed to check idea viability. Please try again.' });
    }
});

// POST /api/expand-idea
router.post('/expand-idea', authMiddleware, async (req, res) => {
    try {
        const { ideaSessionId, selectedIdea, userElaboration, budget, comments } = req.body;
        if (!ideaSessionId || !selectedIdea) {
            return res.status(400).json({ error: 'ideaSessionId and selectedIdea are required' });
        }

        const session = db.prepare('SELECT * FROM ideas WHERE id = ? AND user_id = ?').get(ideaSessionId, req.user.id);
        if (!session) return res.status(404).json({ error: 'Idea session not found' });

        // Save user elaboration
        db.prepare('UPDATE ideas SET selected_idea = ?, user_elaboration = ? WHERE id = ?')
            .run(JSON.stringify(selectedIdea), userElaboration || null, ideaSessionId);

        const expandedIdea = await expandIdea(selectedIdea, userElaboration, budget, comments);
        res.json({ ideaSessionId, expandedIdea });
    } catch (err) {
        console.error('Expand idea error:', err);
        res.status(500).json({ error: err.message || 'Failed to expand idea. Please try again.' });
    }
});

// POST /api/strategic-directions
router.post('/strategic-directions', authMiddleware, async (req, res) => {
    try {
        const { ideaSessionId, selectedIdea, userElaboration, comments } = req.body;
        if (!ideaSessionId || !selectedIdea) {
            return res.status(400).json({ error: 'ideaSessionId and selectedIdea are required' });
        }

        const session = db.prepare('SELECT * FROM ideas WHERE id = ? AND user_id = ?').get(ideaSessionId, req.user.id);
        if (!session) return res.status(404).json({ error: 'Idea session not found' });

        // Save selected idea and user elaboration to session
        db.prepare('UPDATE ideas SET selected_idea = ?, user_elaboration = ? WHERE id = ?')
            .run(JSON.stringify(selectedIdea), userElaboration || null, ideaSessionId);

        const directions = await generateStrategicDirections(selectedIdea, userElaboration, comments);
        res.json({ ideaSessionId, directions });
    } catch (err) {
        console.error('Strategic directions error:', err);
        res.status(500).json({ error: err.message || 'Failed to generate strategic directions. Please try again.' });
    }
});

// POST /api/analyze-idea
router.post('/analyze-idea', authMiddleware, async (req, res) => {
    try {
        const { ideaSessionId, selectedIdea, strategicDirection, userElaboration } = req.body;
        if (!ideaSessionId || !selectedIdea) {
            return res.status(400).json({ error: 'ideaSessionId and selectedIdea are required' });
        }

        const session = db.prepare('SELECT * FROM ideas WHERE id = ? AND user_id = ?').get(ideaSessionId, req.user.id);
        if (!session) return res.status(404).json({ error: 'Idea session not found' });

        const { skills, time_available, budget_level, experience_level } = session;

        // Save strategic direction if provided
        if (strategicDirection) {
            db.prepare('UPDATE ideas SET strategic_direction = ? WHERE id = ?')
                .run(JSON.stringify(strategicDirection), ideaSessionId);
        }

        // Perform the single unified analysis
        const blueprint = await analyzeIdeaBusinessBlueprint(
            selectedIdea,
            skills,
            time_available,
            budget_level,
            experience_level,
            strategicDirection || null,
            userElaboration || session.user_elaboration || null
        );

        // Compute composite feasibility score from AI sub-scores using scoringEngine
        const { calculateFeasibilityScore, calculateFallbackSubScores } = require('../services/scoringEngine');
        if (blueprint.scores && Object.keys(blueprint.scores).length > 0) {
            const scoreResult = calculateFeasibilityScore(blueprint.scores);
            // Attach computed composite score and breakdown to the blueprint
            blueprint.feasibilityScore = scoreResult.compositeScore;
            blueprint.scores.compositeScore = scoreResult.compositeScore;
            blueprint.scores.grade = scoreResult.grade;
            blueprint.scores.breakdown = scoreResult.breakdown;
        } else {
            // Fallback: if AI didn't return sub-scores, calculate them dynamically from user profile
            const fallbackSubScores = calculateFallbackSubScores({
                budget_level,
                time_available,
                experience_level,
                skills
            });
            const scoreResult = calculateFeasibilityScore(fallbackSubScores);

            blueprint.feasibilityScore = scoreResult.compositeScore;
            blueprint.scores = {
                ...fallbackSubScores,
                compositeScore: scoreResult.compositeScore,
                grade: scoreResult.grade,
                breakdown: scoreResult.breakdown,
                scoreRationale: 'Sub-scores were dynamically calculated based on your profile inputs.'
            };
        }

        // Save selected idea to session
        db.prepare('UPDATE ideas SET selected_idea = ? WHERE id = ?')
            .run(JSON.stringify(selectedIdea), ideaSessionId);

        // Save analysis using the existing schema structure (stringified sections)
        const existing = db.prepare('SELECT id FROM analysis_results WHERE idea_id = ?').get(ideaSessionId);

        // We map the unified blueprint back into the columns for backward database compatibility
        const marketData = JSON.stringify({ marketGap: blueprint.marketGap });
        const competitorsData = JSON.stringify(blueprint.competitors);
        const feasibilityData = JSON.stringify({ feasibilityScore: blueprint.feasibilityScore, scores: blueprint.scores });
        const techStackData = JSON.stringify(blueprint.techStack);
        const monetizationData = JSON.stringify(blueprint.monetization);
        const roadmapData = JSON.stringify(blueprint.roadmap);

        // Agentic V2 Adversarial data
        const adversarialData = JSON.stringify({
             theReaper: blueprint.theReaper,
             thePainMiner: blueprint.thePainMiner,
             pricingArchitect: blueprint.pricingArchitect,
             thePivotMaster: blueprint.thePivotMaster,
             researchSources: blueprint.researchSources
        });

        if (existing) {
            db.prepare(`
        UPDATE analysis_results SET market=?, competitors=?, feasibility=?, tech_stack=?, monetization=?, roadmap=?, adversarial=? WHERE idea_id=?
      `).run(
                marketData, competitorsData, feasibilityData, techStackData, monetizationData, roadmapData, adversarialData, ideaSessionId
            );
        } else {
            db.prepare(`
        INSERT INTO analysis_results (idea_id, market, competitors, feasibility, tech_stack, monetization, roadmap, adversarial)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
                ideaSessionId, marketData, competitorsData, feasibilityData, techStackData, monetizationData, roadmapData, adversarialData
            );
        }

        res.json({ ideaSessionId, selectedIdea, blueprint });
    } catch (err) {
        console.error('Analyze idea error:', err);
        res.status(500).json({ error: err.message || 'Failed to analyze idea. Please try again.' });
    }
});

// POST /api/save-idea
router.post('/save-idea', authMiddleware, async (req, res) => {
    try {
        const { ideaSessionId } = req.body;
        if (!ideaSessionId) return res.status(400).json({ error: 'ideaSessionId required' });

        const session = db.prepare('SELECT * FROM ideas WHERE id = ? AND user_id = ?').get(ideaSessionId, req.user.id);
        if (!session) return res.status(404).json({ error: 'Idea not found' });

        res.json({ success: true, message: 'Idea saved to your account', ideaSessionId });
    } catch (err) {
        res.status(500).json({ error: 'Failed to save idea' });
    }
});

// GET /api/ideas - Get all saved ideas for user
router.get('/ideas', authMiddleware, (req, res) => {
    try {
        const ideas = db.prepare(`
      SELECT i.id, i.domain, i.skills, i.time_available, i.budget_level, i.experience_level,
             i.selected_idea, i.created_at,
             ar.market, ar.feasibility
      FROM ideas i
      LEFT JOIN analysis_results ar ON ar.idea_id = i.id
      WHERE i.user_id = ? AND i.selected_idea IS NOT NULL
      ORDER BY i.created_at DESC
    `).all(req.user.id);

        const parsed = ideas.map(idea => ({
            ...idea,
            selectedIdea: idea.selected_idea ? JSON.parse(idea.selected_idea) : null,
            market: idea.market ? JSON.parse(idea.market) : null,
            feasibility: idea.feasibility ? JSON.parse(idea.feasibility) : null,
        }));

        res.json({ ideas: parsed });
    } catch (err) {
        console.error('Get ideas error:', err);
        res.status(500).json({ error: 'Failed to fetch ideas' });
    }
});

// GET /api/ideas/:id - Get single idea with full analysis
router.get('/ideas/:id', authMiddleware, (req, res) => {
    try {
        const idea = db.prepare('SELECT * FROM ideas WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
        if (!idea) return res.status(404).json({ error: 'Idea not found' });

        const analysis = db.prepare('SELECT * FROM analysis_results WHERE idea_id = ?').get(idea.id);

        res.json({
            idea: {
                ...idea,
                idea_data: JSON.parse(idea.idea_data),
                selected_idea: idea.selected_idea ? JSON.parse(idea.selected_idea) : null,
            },
            analysis: analysis ? {
                ...analysis,
                market: JSON.parse(analysis.market || 'null'),
                competitors: JSON.parse(analysis.competitors || 'null'),
                feasibility: JSON.parse(analysis.feasibility || 'null'),
                tech_stack: JSON.parse(analysis.tech_stack || 'null'),
                monetization: JSON.parse(analysis.monetization || 'null'),
                roadmap: JSON.parse(analysis.roadmap || 'null'),
                adversarial: JSON.parse(analysis.adversarial || 'null'),
            } : null,
        });
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch idea' });
    }
});

// DELETE /api/ideas/:id
router.delete('/ideas/:id', authMiddleware, (req, res) => {
    try {
        const idea = db.prepare('SELECT id FROM ideas WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
        if (!idea) return res.status(404).json({ error: 'Idea not found' });

        db.prepare('DELETE FROM analysis_results WHERE idea_id = ?').run(idea.id);
        db.prepare('DELETE FROM ideas WHERE id = ?').run(idea.id);

        res.json({ success: true, message: 'Idea deleted successfully' });
    } catch (err) {
        console.error('Delete idea error:', err);
        res.status(500).json({ error: 'Failed to delete idea' });
    }
});

module.exports = router;
