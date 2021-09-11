/* eslint-disable no-await-in-loop */

const {Command, flags} = require('@oclif/command')
const glob = require('fast-glob')
const path = require('path')
const simpleGit = require('simple-git')
const inquirer = require('inquirer')
const semver = require('semver')

class PushCommand extends Command {
  async run() {
    const {args} = this.parse(PushCommand)
    const git = simpleGit()

    const files = await glob('packages/*/package.json')

    if (files.length === 0) {
      this.log('⚠️ No packages found in this repo')
      return
    }

    const packages = await Promise.all(files.map(async file => {
      const packageJsonPath = path.join(process.cwd(), file)
      const packagePath = path.dirname(packageJsonPath)
      const packageJson = require(packageJsonPath)

      const packageHistory = await git.log({
        from: `${packageJson.name}@${packageJson.version}`,
        to: 'HEAD',
        file: packagePath,
      })

      const dependencies = []

      if (packageJson.dependencies) {
        dependencies.push(...Object.keys(packageJson.dependencies))
      }

      if (packageJson.devDependencies) {
        dependencies.push(...Object.keys(packageJson.devDependencies))
      }

      if (packageJson.optionalDependencies) {
        dependencies.push(...Object.keys(packageJson.optionalDependencies))
      }

      return {
        name: packageJson.name,
        version: packageJson.version,
        tagName: `${packageJson.name}@${packageJson.version}`,
        newCommits: packageHistory.all.length,
        packagePath,
        dependencies,
      }
    }))

    const packagesWithNewCommits = packages.filter(p => p.newCommits > 0)

    if (packagesWithNewCommits.length === 0) {
      this.log('✨ All packages are up-to-date!')
      return
    }

    const repoPackageNames = packages.map(p => p.name)

    for (const p of packages) {
      p.dependedUponByOtherPackages = packages.map(p2 => p2.dependencies.includes(p.name) ? p2.name : null).filter(v => v)
    }

    packagesWithNewCommits.sort((a, b) => a.name - b.name)

    const {packagesToRelease} = await inquirer.prompt([{
      type: 'checkbox',
      name: 'packagesToRelease',
      message: 'Select packages to release',
      pageSize: 20,
      choices: packagesWithNewCommits.map(p => ({
        name: `${p.name} (currently ${p.version})`,
        value: p,
        short: p.name,
      })),
    }])

    if (packagesToRelease.length === 0) {
      this.log('👍 No packages selected')
      return
    }

    for (const p of packagesToRelease) {
      this.log(`⚙️ Releasing ${p.name}`)
    }

    for (const p of packages) {
      // We are already releasing this package
      if (packagesToRelease.some(pnc => pnc.name === p.name)) {
        continue
      }

      // Check whether this package uses packages that are being bumped
      // if these dependencies include a package we're about to release
      p.dependsUponPackagesBeingReleased = p.dependencies.some(p2 => packagesToRelease.some(p3 => p3.name === p2))

      if (p.dependsUponPackagesBeingReleased) {
        this.log(`ℹ️  Additionally releasing ${p.name}`)
        packagesToRelease.push(p)
      }
    }

    packagesToRelease.sort((a, b) => b.dependedUponByOtherPackages.length - a.dependedUponByOtherPackages.length)

    for (const p of packagesToRelease) {
      const newVersions = {
        patch: semver.inc(p.version, 'patch'),
        minor: semver.inc(p.version, 'minor'),
        major: semver.inc(p.version, 'major'),
      }

      const result = await inquirer.prompt([{
        type: 'list',
        name: 'bumpedVersion',
        message: `${p.name} (currently ${p.version}, used by ${p.dependedUponByOtherPackages.length} internal packages):`,
        default: newVersions.patch,
        choices: [
          {
            name: `Patch (${newVersions.patch})`,
            value: newVersions.patch,
          },
          {
            name: `Minor (${newVersions.minor})`,
            value: newVersions.minor,
          },
          {
            name: `Major (${newVersions.major})`,
            value: newVersions.major,
          },
          {
            name: 'Custom (Enter new version)',
            value: 'custom',
          },
        ],
      }])

      let bumpedVersion

      if (result.bumpedVersion === 'custom') {
        const customVersion = await inquirer.prompt([{
          type: 'input',
          name: 'bumpedVersion',
          message: `Enter version for ${p.name} (currently ${p.version}):`,
        }])
        p.bumpedVersion = customVersion.bumpedVersion
      } else {
        p.bumpedVersion = result.bumpedVersion
      }
    }

    console.log(packagesToRelease)
  }
}

module.exports = PushCommand
