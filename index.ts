import {
	CameraSDK,
	Creep,
	CreepPathCorner,
	DotaMap,
	EntityManager,
	EventsSDK,
	Hero,
	LocalPlayer,
	MapArea,
	Menu,
	QAngle,
	Tower,
	Vector3
} from "github.com/octarine-public/wrapper/index"

new (class WorfScript {
	private readonly entry = Menu.AddEntry("Utility")
	private readonly menu = this.entry.AddNode(
		"Worf Script",
		"panorama/images/hud/reborn/icon_magic_resist_psd.vtex_c"
	)
	private readonly enabledToggle = this.menu.AddToggle("Enabled", true)
	private readonly laneDropdown = this.menu.AddDropdown(
		"Lane",
		["Top", "Middle", "Bottom"],
		1,
		"Select lane to auto-push"
	)
	private readonly creepDistSlider = this.menu.AddSlider(
		"Creep distance",
		300,
		0,
		2000,
		0,
		"Target distance from friendly creeps"
	)
	private readonly enemyDistSlider = this.menu.AddSlider(
		"Enemy distance",
		300,
		0,
		2000,
		0,
		"Minimum safe distance from enemy heroes"
	)

	private readonly CAMERA_ANGLE = new QAngle(60, 90, 0)
	private readonly CAMERA_DISTANCE = 1200

	constructor() {
		EventsSDK.on("PostDataUpdate", this.OnTick.bind(this))
		EventsSDK.on("GameEnded", this.GameEnded.bind(this))
	}

	private GameEnded(): void {
		// cleanup if needed
	}

	private OnTick(): void {
		if (!this.enabledToggle.value) {
			return
		}
		const hero = LocalPlayer?.Hero
		if (hero === undefined || !hero.IsAlive || !hero.IsSpawned) {
			return
		}

		this.lockCamera(hero)
		this.processAutoPush(hero)
	}

	private lockCamera(hero: Hero): void {
		CameraSDK.Position = hero.Position.Clone()
		CameraSDK.Angles = this.CAMERA_ANGLE
		CameraSDK.Distance = this.CAMERA_DISTANCE
	}

	private getSelectedLane(): MapArea {
		return (this.laneDropdown.SelectedID + 1) as MapArea
	}

	private processAutoPush(hero: Hero): void {
		const lane = this.getSelectedLane()
		const heroTeam = hero.Team

		// Priority 1: Last-hit enemy creeps
		const creepList = EntityManager.GetEntitiesByClass(Creep)
		const laneCreeps = this.getLaneCreeps(creepList, lane)
		const lastHitTarget = this.findLastHitTarget(hero, laneCreeps)
		if (lastHitTarget !== undefined) {
			hero.AttackTarget(lastHitTarget)
			return
		}

		// Priority 2: Retreat from nearby enemy heroes
		const heroList = EntityManager.GetEntitiesByClass(Hero)
		const nearestEnemy = this.getNearestEnemyHero(hero, heroList)
		if (nearestEnemy !== undefined) {
			const enemyDist = nearestEnemy.Distance2D(hero)
			if (enemyDist < this.enemyDistSlider.value) {
				this.retreatFrom(hero, nearestEnemy.Position)
				return
			}
		}

		// Priority 3: Avoid enemy tower range
		const buildingList = EntityManager.GetEntitiesByClass(Tower)
		if (this.isInTowerRange(hero, buildingList)) {
			const nextCorner = DotaMap.GetCreepCurrentTarget(
				hero.Position,
				heroTeam,
				lane
			)
			this.moveToSafePosition(hero, nextCorner, buildingList)
			return
		}

		// Priority 4: Position near friendly creeps
		const nextCorner = DotaMap.GetCreepCurrentTarget(
			hero.Position,
			heroTeam,
			lane
		)
		this.positionNearCreeps(hero, laneCreeps, nextCorner)
	}

	private getLaneCreeps(creeps: Creep[], lane: MapArea): Creep[] {
		const result: Creep[] = []
		for (let i = 0; i < creeps.length; i++) {
			const creep = creeps[i]
			if (creep.IsSpawned && creep.IsAlive && creep.Lane === lane) {
				result.push(creep)
			}
		}
		return result
	}

	private findLastHitTarget(hero: Hero, laneCreeps: Creep[]): Creep | undefined {
		for (let i = 0; i < laneCreeps.length; i++) {
			const creep = laneCreeps[i]
			if (!creep.IsEnemy(hero)) {
				continue
			}
			if (!hero.CanAttack(creep)) {
				continue
			}
			const rawDamage = hero.GetRawAttackDamage(creep)
			if (rawDamage <= 0) {
				continue
			}

			let adjustedHP = creep.HP
			if (hero.IsRanged) {
				const dist = hero.Distance2D(creep)
				const projectileTime = dist / 1200
				adjustedHP = creep.HP - 40 * projectileTime
			}

			if (rawDamage >= adjustedHP) {
				return creep
			}
		}
		return undefined
	}

	private getNearestEnemyHero(hero: Hero, heroes: Hero[]): Hero | undefined {
		let nearest: Hero | undefined
		let minDist = Infinity
		for (let i = 0; i < heroes.length; i++) {
			const enemy = heroes[i]
			if (
				enemy === hero ||
				!enemy.IsEnemy(hero) ||
				!enemy.IsAlive ||
				!enemy.IsSpawned
			) {
				continue
			}
			const dist = enemy.Distance2D(hero)
			if (dist < minDist) {
				minDist = dist
				nearest = enemy
			}
		}
		return nearest
	}

	private retreatFrom(hero: Hero, threatPos: Vector3): void {
		const dir = hero.Position
			.Clone()
			.Subtract(threatPos)
			.Normalize()
			.MultiplyScalarForThis(400)
		const retreatPos = hero.Position.Clone().Add(dir)
		hero.MoveTo(retreatPos)
	}

	private isInTowerRange(hero: Hero, towers: Tower[]): boolean {
		for (let i = 0; i < towers.length; i++) {
			const tower = towers[i]
			if (!tower.IsAlive || !tower.IsSpawned || !tower.IsEnemy(hero)) {
				continue
			}
			const dist = tower.Distance2D(hero)
			const range = tower.GetAttackRange() + 100
			if (dist <= range) {
				return true
			}
		}
		return false
	}

	private moveToSafePosition(
		hero: Hero,
		nextCorner: CreepPathCorner | undefined,
		towers: Tower[]
	): void {
		if (nextCorner !== undefined && nextCorner.Referencing.size > 0) {
			const prevCorners = [...nextCorner.Referencing]
			hero.MoveTo(prevCorners[0].Position)
			return
		}
		// Fallback: move toward nearest friendly building
		let nearestBuilding: typeof towers[number] | undefined
		let minDist = Infinity
		for (let i = 0; i < towers.length; i++) {
			const b = towers[i]
			if (!b.IsEnemy(hero) && b.IsAlive) {
				const d = b.Distance2D(hero)
				if (d < minDist) {
					minDist = d
					nearestBuilding = b
				}
			}
		}
		if (nearestBuilding !== undefined) {
			hero.MoveTo(nearestBuilding.Position)
		}
	}

	private positionNearCreeps(
		hero: Hero,
		laneCreeps: Creep[],
		nextCorner: CreepPathCorner | undefined
	): void {
		const targetDist = this.creepDistSlider.value
		let nearestFriendly: Creep | undefined
		let minDist = Infinity

		for (let i = 0; i < laneCreeps.length; i++) {
			const creep = laneCreeps[i]
			if (creep.IsEnemy(hero)) {
				continue
			}
			const dist = creep.Distance2D(hero)
			if (dist < minDist) {
				minDist = dist
				nearestFriendly = creep
			}
		}

		if (nearestFriendly === undefined) {
			if (nextCorner !== undefined) {
				hero.MoveTo(nextCorner.Position)
			}
			return
		}

		if (minDist > targetDist + 50) {
			hero.MoveTo(nearestFriendly.Position)
		} else if (minDist < targetDist - 50) {
			const awayDir = hero.Position
				.Clone()
				.Subtract(nearestFriendly.Position)
				.Normalize()
				.MultiplyScalarForThis(200)
			const newPos = hero.Position.Clone().Add(awayDir)
			hero.MoveTo(newPos)
		} else if (nextCorner !== undefined) {
			hero.MoveTo(nextCorner.Position)
		}
	}
})()
