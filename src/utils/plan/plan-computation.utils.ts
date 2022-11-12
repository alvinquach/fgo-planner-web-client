import { CollectionUtils, Immutable, ImmutableArray, Nullable, ObjectUtils, ReadonlyRecord } from '@fgo-planner/common-core';
import { GameServant, GameServantEnhancement, GameServantSkillMaterials, ImmutableMasterAccount, ImmutableMasterServant, InstantiatedServantAscensionLevel, InstantiatedServantConstants, InstantiatedServantSkillLevel, InstantiatedServantUtils, Plan, PlanServant } from '@fgo-planner/data-core';
import { GameServantMap, PlanEnhancementItemRequirements as EnhancementItemRequirements, PlanEnhancementRequirements as EnhancementRequirements, PlanRequirements, PlanServantRequirements } from '../../types/data';

//#region Exported type definitions

export type ComputationOptions = {
    includeAscensions?: boolean;
    includeSkills?: boolean;
    includeAppendSkills?: boolean;
    includeCostumes?: boolean;
    excludeLores?: boolean;
};

//#endregion


//#region Internal type definitions

type SkillEnhancements = Readonly<{
    1?: Nullable<InstantiatedServantSkillLevel>;
    2?: Nullable<InstantiatedServantSkillLevel>;
    3?: Nullable<InstantiatedServantSkillLevel>;
}>;

type ServantEnhancements = Immutable<{
    ascension?: Nullable<InstantiatedServantAscensionLevel>;
    skills: SkillEnhancements;
    appendSkills: SkillEnhancements;
}>;

/**
 * Simplified version of `MasterAccount` for internal use.
 */
type MasterAccountData = Readonly<{
    /**
     * Map of item quantities held by the master account, where the key is the
     * `itemId` and the value is the quantity.
     */
    items: ReadonlyRecord<number, number>;
    /**
     * Map of servants in the master account, where the key is the `instanceId` and
     * the value is the `MasterServant`
     */
    servants: ReadonlyRecord<number, ImmutableMasterServant>;
    costumes: ReadonlySet<number>;
    qp: number;
}>;

//#endregion


export class PlanComputationUtils {

    private static get _defaultOptions(): Readonly<ComputationOptions> {
        return {
            includeAscensions: true,
            includeSkills: true,
            includeAppendSkills: true,
            includeCostumes: true
        };
    };

    private static get _defaultTargetEnhancements(): Immutable<ServantEnhancements> {
        return {
            ascension: InstantiatedServantConstants.MaxAscensionLevel,
            skills: {
                1: InstantiatedServantConstants.MaxSkillLevel,
                2: InstantiatedServantConstants.MaxSkillLevel,
                3: InstantiatedServantConstants.MaxSkillLevel
            },
            appendSkills: {
                1: InstantiatedServantConstants.MaxSkillLevel,
                2: InstantiatedServantConstants.MaxSkillLevel,
                3: InstantiatedServantConstants.MaxSkillLevel,
            }
        };
    };

    private constructor () {
        
    }

    /**
     * Adds the values from the source `EnhancementRequirements` to the target
     * `EnhancementRequirements`. Only the the target map will be updated; the
     * values of the source map will not be changed.
     */
    static addEnhancementRequirements(target: EnhancementRequirements, source: EnhancementRequirements): void {
        const targetEmbers = target.embers;
        for (const [key, value] of Object.entries(source.embers)) {
            const rarity = Number(key) as 1 | 2 | 3 | 4 | 5;
            targetEmbers[rarity] += value;
        }
        const targetItems = target.items;
        for (const [key, value] of Object.entries(source.items)) {
            const itemId = Number(key);
            if (!targetItems[itemId]) {
                targetItems[itemId] = { ...value };
            } else {
                this._addEnhancementItemRequirements(targetItems[itemId], value);
            }
        }
        target.qp += source.qp;
    }

    /**
     * Takes an array of `EnhancementRequirements` and returns a new
     * `EnhancementRequirements` containing the sum of all the values.
     */
    static sumEnhancementRequirements(arr: Array<EnhancementRequirements>): EnhancementRequirements {
        const result = this._instantiateEnhancementRequirements();
        for (const enhancementRequirements of arr) {
            this.addEnhancementRequirements(result, enhancementRequirements);
        }
        return result;
    }

    //#region computePlanRequirements + helper methods

    /**
     * Computes the material debt for the given plan, and optionally the other plans
     * from the plan group, if any.
     *
     * @param gameServantMap Game servant map data.
     * @param masterAccount Master account data.
     * @param targetPlan The target plan.
     * @param previousPlans (optional) Plans that precede the target plan. This
     * should exclude the target plan itself and any proceeding plans.
     */
    static computePlanRequirements(
        gameServantMap: GameServantMap,
        masterAccount: ImmutableMasterAccount,
        targetPlan: Immutable<Plan>,
        previousPlans?: ImmutableArray<Plan>,
        optionsOverride?: ComputationOptions
    ): PlanRequirements {

        const start = window.performance.now();

        /**
         * The computation result. This will be updated as each plan is computed.
         */
        const result = this._instantiatePlanRequirements();

        /**
         * Pre-processed master account data.
         */
        const masterAccountData = this._preProcessMasterAccount(masterAccount);

        /**
         * The computation options. If options override was not given, then use options
         * from target plan.
         */
        const options = optionsOverride || this._parseComputationOptions(targetPlan);

        /**
         * Run computations for previous plans in the group first.
         */
        previousPlans?.forEach(plan => {
            this._computePlanRequirements(
                result,
                gameServantMap,
                masterAccountData,
                plan,
                options
            );
        });
        /**
         * Finally, run computations for the target plan.
         */
        this._computePlanRequirements(
            result,
            gameServantMap,
            masterAccountData,
            targetPlan,
            options,
            true
        );

        const end = window.performance.now();
        console.log(`Plan debt took ${(end - start).toFixed(2)}ms to compute.`);
        console.log(result);
        return result;
    }

    private static _computePlanRequirements(
        result: PlanRequirements,
        gameServantMap: GameServantMap,
        masterAccountData: MasterAccountData,
        plan: Immutable<Plan>,
        options: ComputationOptions,
        isTargetPlan = false
    ): void {

        const targetCostumes = CollectionUtils.toReadonlySet(plan.costumes);

        for (const planServant of plan.servants) {
            /**
             * Skip the servant if it is not enabled.
             */
            if (!planServant.enabled.servant) {
                continue;
            }
            /**
             * Retrieve the master servant data from the map.
             */
            /** */
            const masterServant = masterAccountData.servants[planServant.instanceId];
            if (!masterServant) {
                continue;
            }
            /**
             * Retrieve the game servant data from the map.
             */
            /** */
            const gameServant = gameServantMap[masterServant.gameId];
            if (!gameServant) {
                continue;
            }
            /**
             * Compute the options based on a merge of the plan and servant options.
             */
            /** */
            const servantOptions = this._parseComputationOptions(planServant);
            const mergedOptions = this._mergeComputationOptions(options, servantOptions);
            /**
             * Compute the debt for the servant for the current plan.
             */
            /** */
            const servantComputationResult = this._computePlanServantRequirements(
                result,
                gameServant,
                masterServant,
                planServant,
                masterAccountData.costumes,
                targetCostumes,
                mergedOptions
            );

            if (!servantComputationResult) {
                continue;
            }

            const [planServantRequirements, enhancementRequirements] = servantComputationResult;
            /**
             * Update the result with the computed data.
             */
            /** */
            let planEnhancementRequirements: EnhancementRequirements;
            if (isTargetPlan) {
                this.addEnhancementRequirements(planServantRequirements.requirements, enhancementRequirements);
                planEnhancementRequirements = result.targetPlan;
            } else {
                const { previousPlans } = result;
                planEnhancementRequirements = ObjectUtils.getOrDefault(previousPlans, plan._id, this._instantiateEnhancementRequirements);
            }
            this.addEnhancementRequirements(planEnhancementRequirements, enhancementRequirements);
            this.addEnhancementRequirements(result.group, enhancementRequirements);
        }

        // TODO Compute the grand total in the `result.itemDebt`;
    }

    private static _computePlanServantRequirements(
        result: PlanRequirements,
        gameServant: Immutable<GameServant>,
        masterServant: ImmutableMasterServant,
        planServant: Immutable<PlanServant>,
        currentCostumes: ReadonlySet<number>,
        targetCostumes: ReadonlySet<number>,
        options: ComputationOptions
    ): [PlanServantRequirements, EnhancementRequirements] | undefined {

        const { instanceId } = planServant;
        const resultServants = result.servants;

        let planServantRequirements = resultServants[instanceId];
        if (!planServantRequirements) {
            /**
             * If the plan servant does not yet exist in the result, then instantiate it and
             * add it to the result.
             */
            planServantRequirements = this._instantiatePlanServantRequirements(planServant, masterServant);
            resultServants[instanceId] = planServantRequirements;
        } else {
            /**
             * If the plan servant was already in the result, then it was from a previous
             * plan in the group. This means the for the current plan, the previous target
             * enhancements should be the new current, and the target values from the plan
             * should be the new target.
             */
            InstantiatedServantUtils.updateEnhancements(planServantRequirements.current, planServantRequirements.target);
            InstantiatedServantUtils.updateEnhancements(planServantRequirements.target, planServant);
        }

        const { current, target } = planServantRequirements;

        const enhancementRequirements = this._computeServantEnhancementRequirements(
            gameServant,
            current,
            currentCostumes,
            target,
            targetCostumes,
            options
        );

        return [planServantRequirements, enhancementRequirements];
    }

    private static _preProcessMasterAccount(masterAccount: ImmutableMasterAccount): MasterAccountData {
        const servants = CollectionUtils.mapIterableToObject(masterAccount.servants, InstantiatedServantUtils.getInstanceId);
        const items = masterAccount.resources.items;
        const costumes = new Set(masterAccount.costumes);
        const qp = masterAccount.resources.qp;

        return { servants, items, costumes, qp };
    }

    //#endregion


    //#region computeServantRequirements + helper methods

    static computeServantEnhancementRequirements(
        gameServant: Immutable<GameServant>,
        currentEnhancements: ServantEnhancements,
        currentCostumes: Iterable<number>,
        options?: ComputationOptions
    ): EnhancementRequirements {

        const currentCostumeSet = CollectionUtils.toReadonlySet(currentCostumes);

        return this._computeServantEnhancementRequirements(
            gameServant,
            currentEnhancements,
            currentCostumeSet,
            this._defaultTargetEnhancements,
            undefined,
            options
        );
    }

    private static _computeServantEnhancementRequirements(
        gameServant: Immutable<GameServant>,
        currentEnhancements: Immutable<ServantEnhancements>,
        currentCostumes: ReadonlySet<number>,
        targetEnhancements: Immutable<ServantEnhancements>,
        targetCostumes?: ReadonlySet<number>,
        options = this._defaultOptions
    ): EnhancementRequirements {

        const {
            includeAscensions,
            includeSkills,
            includeAppendSkills,
            includeCostumes,
            excludeLores
        } = options;

        /**
         * The result data for the servant, instantiated with an entry for QP.
         */
        const result = this._instantiateEnhancementRequirements();

        if (includeSkills) {
            this._updateResultForSkills(
                result,
                gameServant.skillMaterials,
                currentEnhancements.skills,
                targetEnhancements.skills,
                'skills',
                excludeLores
            );
        }

        if (includeAppendSkills) {
            this._updateResultForSkills(
                result,
                gameServant.appendSkillMaterials,
                currentEnhancements.appendSkills,
                targetEnhancements.appendSkills,
                'appendSkills',
                excludeLores
            );
        }

        const targetAscension = targetEnhancements.ascension;
        if (includeAscensions && targetAscension != null) {
            if (gameServant.ascensionMaterials) {
                for (const [key, ascension] of Object.entries(gameServant.ascensionMaterials)) {
                    const ascensionLevel = Number(key);
                    const currentAscension = currentEnhancements.ascension || 0;
                    /**
                     * Skip this ascension if the servant is already at least this level, or if this
                     * level beyond the targeted level.
                     */
                    if (currentAscension >= ascensionLevel || ascensionLevel > targetAscension) {
                        continue;
                    }
                    this._updateEnhancementRequirementResult(result, ascension, 'ascensions');
                }
            }
            // TODO Compute ember requirements
        }

        if (includeCostumes) {
            for (const [key, costume] of Object.entries(gameServant.costumes)) {
                const costumeId = Number(key);
                /**
                 * Skip if the costume is already unlocked, or if it is not targeted. If the
                 * targetCostumes set is undefined, then all costumes are target by default.
                 */
                if (currentCostumes.has(costumeId) || (targetCostumes && !targetCostumes.has(costumeId))) {
                    continue;
                }
                this._updateEnhancementRequirementResult(result, costume.materials, 'costumes');
            }
        }

        return result;
    }

    private static _updateResultForSkills(
        result: EnhancementRequirements,
        skillMaterials: Immutable<GameServantSkillMaterials>,
        currentSkills: SkillEnhancements,
        targetSkills: SkillEnhancements,
        skillType: 'skills' | 'appendSkills',
        excludeLores?: boolean
    ): void {

        const currentSkill1 = currentSkills[1] || 0;
        const currentSkill2 = currentSkills[2] || 0;
        const currentSkill3 = currentSkills[3] || 0;

        const targetSkill1 = targetSkills[1] || 0;
        const targetSkill2 = targetSkills[2] || 0;
        const targetSkill3 = targetSkills[3] || 0;

        for (const [key, skill] of Object.entries(skillMaterials)) {
            const skillLevel = Number(key);
            if (excludeLores && skillLevel === (InstantiatedServantConstants.MaxSkillLevel - 1)) {
                continue;
            }
            /**
             * The number of skills that need to be upgraded to this level. A skill does not
             * need to be upgraded if it is already at least this level, or if this level beyond
             * the targeted level.
             */
            /** */
            const skillUpgradeCount =
                (currentSkill1 > skillLevel || skillLevel >= targetSkill1 ? 0 : 1) +
                (currentSkill2 > skillLevel || skillLevel >= targetSkill2 ? 0 : 1) +
                (currentSkill3 > skillLevel || skillLevel >= targetSkill3 ? 0 : 1);
            /**
             * Skip if all three skills do not need enhancement at this level.
             */
            if (skillUpgradeCount === 0) {
                continue;
            }
            this._updateEnhancementRequirementResult(result, skill, skillType, skillUpgradeCount);
        }
    }

    private static _updateEnhancementRequirementResult(
        result: EnhancementRequirements,
        enhancement: Immutable<GameServantEnhancement>,
        propertyKey: keyof EnhancementItemRequirements,
        enhancementCount = 1
    ): void {
        /**
         * Update material count.
         */
        for (const [key, quantity] of Object.entries(enhancement.materials)) {
            const itemId = Number(key);
            const itemCount = ObjectUtils.getOrDefault(result.items, itemId, this._instantiateEnhancementItemRequirements);
            const total = quantity * enhancementCount;
            itemCount[propertyKey] += total;
            itemCount.total += total;
        }
        /**
         * Also update QP count.
         */
        result.qp += enhancement.qp * enhancementCount;
    }

    //#endregion


    //#region Other helper methods

    private static _addEnhancementItemRequirements(target: EnhancementItemRequirements, source: EnhancementItemRequirements): void {
        target.ascensions += source.ascensions;
        target.skills += source.skills;
        target.appendSkills += source.appendSkills;
        target.costumes += source.costumes;
        target.total += source.total;
    }

    private static _parseComputationOptions(data: Immutable<Plan> | Immutable<PlanServant>): ComputationOptions {
        const {
            ascensions,
            skills,
            appendSkills,
            costumes
        } = data.enabled;

        return {
            includeAscensions: ascensions,
            includeSkills: skills,
            includeAppendSkills: appendSkills,
            includeCostumes: costumes
        };
    }

    private static _mergeComputationOptions(a: ComputationOptions, b: ComputationOptions): ComputationOptions {
        return {
            includeAscensions: a.includeAscensions && a.includeAscensions,
            includeSkills: a.includeSkills && b.includeSkills,
            includeAppendSkills: a.includeAppendSkills && b.includeAppendSkills,
            includeCostumes: a.includeCostumes && b.includeCostumes,
            excludeLores: a.excludeLores && b.excludeLores
        };
    }

    //#endregion


    //#region Instantiation methods

    private static _instantiateEnhancementItemRequirements(): EnhancementItemRequirements {
        return {
            ascensions: 0,
            skills: 0,
            appendSkills: 0,
            costumes: 0,
            total: 0
        };
    }

    private static _instantiateEnhancementRequirements(): EnhancementRequirements {
        return {
            embers: {
                1: 0,
                2: 0,
                3: 0,
                4: 0,
                5: 0
            },
            items: {},
            qp: 0
        };
    }

    /**
     * Instantiates a `PlanServantRequirements` object using the given plan and
     * master servant data. The `current` enhancement fo the resulting object will
     * be initialized with the values from the master servant.
     */
    private static _instantiatePlanServantRequirements(
        planServant: Immutable<PlanServant>,
        masterServant: ImmutableMasterServant
    ): PlanServantRequirements {

        const current = InstantiatedServantUtils.instantiateEnhancements();
        InstantiatedServantUtils.updateEnhancements(current, masterServant);

        const target = InstantiatedServantUtils.cloneEnhancements(planServant);

        return {
            instanceId: planServant.instanceId,
            current,
            target,
            requirements: this._instantiateEnhancementRequirements()
        };
    }

    private static _instantiatePlanRequirements(): PlanRequirements {
        return {
            servants: {},
            targetPlan: this._instantiateEnhancementRequirements(),
            previousPlans: {},
            group: this._instantiateEnhancementRequirements(),
            itemDebt: {}
        };
    }

    //#endregion

}