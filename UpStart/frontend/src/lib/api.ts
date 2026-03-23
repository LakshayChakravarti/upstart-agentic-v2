const BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';

function getToken(): string | null {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem('upstart_token');
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const token = getToken();
    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...(options.headers as Record<string, string>),
    };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 90000); // 90s timeout

    try {
        const res = await fetch(`${BASE_URL}${path}`, {
            ...options,
            headers,
            signal: controller.signal,
        });

        if (!res.ok) {
            const err = await res.json().catch(() => ({ error: 'Request failed' }));
            throw new Error(err.error || `HTTP ${res.status}`);
        }
        return res.json();
    } catch (err: any) {
        if (err.name === 'AbortError') {
            throw new Error('Request timed out. The AI is taking too long — please try again.');
        }
        throw err;
    } finally {
        clearTimeout(timeoutId);
    }
}

export const apiClient = {
    // Auth
    register: (data: { name: string; email: string; password: string }) =>
        request<{ token: string; user: { id: number; name: string; email: string } }>('/api/auth/register', {
            method: 'POST',
            body: JSON.stringify(data),
        }),

    login: (data: { email: string; password: string }) =>
        request<{ token: string; user: { id: number; name: string; email: string } }>('/api/auth/login', {
            method: 'POST',
            body: JSON.stringify(data),
        }),

    me: () => request<{ user: { id: number; name: string; email: string } }>('/api/auth/me'),

    // Ideas
    generateIdeas: (data: {
        domain: string;
        skills?: string;
        timeAvailable?: string;
        budgetLevel?: string;
        experienceLevel?: string;
        targetUsers?: string;
    }) =>
        request<{ ideaSessionId: number; ideas: Idea[] }>('/api/generate-ideas', {
            method: 'POST',
            body: JSON.stringify(data),
        }),

    analyzeIdea: (data: { ideaSessionId: number; selectedIdea: Idea; strategicDirection?: StrategicDirection; userElaboration?: string }) =>
        request<AnalysisResult>('/api/analyze-idea', {
            method: 'POST',
            body: JSON.stringify(data),
        }),

    checkIdeaViability: (data: { ideaSessionId: number; selectedIdea: Idea }) =>
        request<{ ideaSessionId: number; viabilityResult: ViabilityResult }>('/api/check-idea-viability', {
            method: 'POST',
            body: JSON.stringify(data),
        }),

    getStrategicDirections: (data: { ideaSessionId: number; selectedIdea: Idea; userElaboration: string; comments?: string[] }) =>
        request<{ ideaSessionId: number; directions: StrategicDirection[] }>('/api/strategic-directions', {
            method: 'POST',
            body: JSON.stringify(data),
        }),

    expandIdea: (data: { ideaSessionId: number; selectedIdea: Idea; userElaboration: string; budget: string; comments?: string[] }) =>
        request<{ ideaSessionId: number; expandedIdea: ExpandedIdea }>('/api/expand-idea', {
            method: 'POST',
            body: JSON.stringify(data),
        }),

    saveIdea: (ideaSessionId: number) =>
        request('/api/save-idea', { method: 'POST', body: JSON.stringify({ ideaSessionId }) }),

    getSavedIdeas: () => request<{ ideas: SavedIdea[] }>('/api/ideas'),

    getIdea: (id: number) => request<{ idea: any; analysis: any }>(`/api/ideas/${id}`),

    deleteIdea: (id: number) => request(`/api/ideas/${id}`, { method: 'DELETE' }),
};

export interface Idea {
    title: string;
    problem: string;
    targetUsers: string;
    solution: string;
    tagline: string;
}

export interface ViabilityResult {
    similarity: {
        score: number;
        companies: Array<{
            name: string;
            description: string;
            failureReason: string;
        }>;
    };
    risks: Array<{
        category: string;
        level: 'High' | 'Medium' | 'Low';
        reason: string;
        suggestion: string;
    }>;
}

export interface StrategicDirection {
    directionName: string;
    corePivot: string;
    keyStack: string;
    description: string;
}

export interface ExpandedIdea {
    expandedTitle: string;
    expandedProblem: string;
    expandedSolution: string;
    expandedTargetUsers: string;
    uniqueAngle: string;
    revenueModel: string;
    estimatedBudget: string;
    coreTechApproach: string;
    marketSize: string;
    competitiveEdge: string;
}

export interface AnalysisResult {
    ideaSessionId: number;
    selectedIdea: Idea;
    blueprint: {
        startupName: string;
        tagline: string;
        summary: string;
        pain: string;
        antidote: string;
        redditOsint?: {
            subreddits: string[];
            complaints: string[];
            sentiment: string;
        };
        demandTrend?: {
            keyword: string;
            trendDirection: string;
            summary: string;
        };
        marketGap: string;
        usp?: string;
        feasibilityScore: number; // computed composite (backward compat)
        scores?: {
            technicalFeasibility: number;
            marketReadiness: number;
            regulatoryRisk: number;
            competitiveAdvantage: number;
            executionComplexity: number;
            compositeScore: number;
            grade: string;
            scoreRationale: string;
            breakdown?: Record<string, { raw: number; weight: number; weighted: number }>;
        };
        realityCheck: string;
        scalabilityPath?: string;
        competitors: Array<{
            name: string;
            pricing?: string;
            coreFeatures?: string[];
            breach: string;
            moat?: string;
        }>;
        bmc?: {
            keyPartners: string[];
            keyActivities: string[];
            keyResources: string[];
            valueProposition: string;
            customerRelationships: string[];
            channels: string[];
            customerSegments: string[];
            revenueStreams: string[];
            costStructure: string[];
        };
        pricingTiers?: Array<{ tier: string; price: string; features: string[] }>;
        preSeedCapital?: { total: string; breakdown: string[] };
        exitStrategy?: string;
        techStack: string[];
        edgeTool?: string;
        dataStrategy?: string;
        monetization: string[];
        roadmap: Array<{
            week: string;
            goal: string;
            killerFeature?: string;
            targetGroup?: string;
            seedAsk?: string;
            kpis?: string[];
            tasks: string[];
        }>;
    };
}

export interface SavedIdea {
    id: number;
    domain: string;
    selectedIdea: Idea;
    market: any;
    feasibility: any;
    created_at: string;
}
