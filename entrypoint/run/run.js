const { execSync, spawn, spawnSync } = require('child_process')
import path from 'path'
import filesystem from 'fs'
import configuration from '../../../../setup/configuration/configuration.js'
const applicationPath = path.join(configuration.projectPath, 'application')
const appDeploymentLifecycle = path.join(applicationPath, 'dependency/appDeploymentLifecycle')
console.log(process.argv)

let nodeModuleFolder = `${applicationPath}/source/serverSide/node_modules`
let packageManagerFolder = `${applicationPath}/source/packageManager/server.yarn/`
if(!filesystem.existsSync(nodeModuleFolder)) {
    spawnSync('yarn', [ `install` ], {
        cwd: packageManagerFolder, 
        shell: true, 
        stdio: [0,1,2],
    })
}

/*
 * Usage:
 * • ./entrypoint.sh run
 * • ./entrypoint.sh run sleep // run app with no command, but sleep to keep the container running
 * • ./entrypoint.sh run debug
 * • ./entrypoint.sh run distribution
 * • ./entrypoint.sh run distribution debug
 * • ./entrypoint.sh run livereload
 * • ./entrypoint.sh run livereload debug
 * • ./entrypoint.sh run livereload distribution
 * • ./entrypoint.sh run livereload distribution debug
 */
let ymlFile = `${appDeploymentLifecycle}/deploymentContainer/development.dockerCompose.yml`
let serviceName = 'nodejs'
let containerPrefix = 'app'
let debug, command, environmentVariable
switch (process.argv[0]) {
    case 'livereload':
        console.log('• Running application in livereload mode.')    
        
        let additionalEnvironmentVariable = {}
        if(process.argv[0] == 'distribution' || process.argv[1] == 'distribution') {
            additionalEnvironmentVariable.SZN_OPTION_ENTRYPOINT_NAME = "entrypoint.js"
            additionalEnvironmentVariable.SZN_OPTION_ENTRYPOINT_PATH = "/project/application/distribution/serverSide/"
        }
        let debugCommand = (process.argv[1] == 'debug' || process.argv[2] == 'debug') ? '--inspect=localhost:9229 --debug-brk' : '';
        let sourceCodePath = path.join(configuration.SourceCodePath, 'serverSide')
        debug = (process.argv[1] == 'debug' || process.argv[2] == 'debug') ? true : false;
        let command = `node ${debugCommand} ${appDeploymentLifecycle}/nodejsLivereload/ watch:livereload`
        let environmentVariable = {
            DEPLOYMENT: "development",
            SZN_DEBUG: debug,
            hostPath: process.env.hostPath
        }
        console.log(`• nodejs command = ${command}`)
        spawnSync('docker-compose', [
                `-f ${ymlFile} --project-name ${containerPrefix} run --service-ports --entrypoint '${command}' ${serviceName}`
            ], {
                // cwd: `${applicationPath}`, 
                shell: true, 
                stdio: [0,1,2], 
                env: Object.assign(environmentVariable, additionalEnvironmentVariable)
            })
    break;
    default:
        console.log('• Running entrypoint application in default mode.')    
        console.log(process.argv)
        debug = (process.argv[1] == 'debug' || process.argv[0] == 'debug' || process.argv[2] == 'debug') ? '--inspect=localhost:9229 --debug-brk' : '';
        let appEntrypointPath = (process.argv[0] == 'distribution' || process.argv[1] == 'distribution') ? `${applicationPath}/distribution/serverSide/entrypoint.js`: `${applicationPath}/source/serverSide/entrypoint.js`;
        console.log(`App enrypoint path: ${appEntrypointPath}`)
        command = (process.argv[0] == 'sleep' || process.argv[1] == 'sleep') ? 'sleep 100000' : `node ${debug} ${appEntrypointPath}`;
        console.log(`• nodejs command = ${command}`)
        environmentVariable = {
            DEPLOYMENT: "development",
            SZN_DEBUG: false,
            hostPath: process.env.hostPath
        }
        spawnSync('docker-compose', [
                `-f ${ymlFile} --project-name ${containerPrefix} run --service-ports --entrypoint '${command}' ${serviceName}`
            ], {
                // cwd: `${applicationPath}`, 
                shell: true, 
                stdio: [0,1,2], 
                env: environmentVariable
            })
    break;
}

