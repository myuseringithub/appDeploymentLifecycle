/*
 * Uses environment variable to point to the key for Google Cloud authentication.
 * https://cloud.google.com/nodejs/docs/reference/compute/0.9.x/Address#create
 * https://cloud.google.com/compute/docs/reference/latest/instances
 * https://cloud.google.com/sdk/gcloud/reference/compute/instances/create
 * Paths to resources as defined by GCloud server are present in the api documentation on top - e.g. https://cloud.google.com/compute/docs/reference/latest/subnetworks/get
 */
import { getVMTemplate, getVM, addAccessConfig } from './googleapis.js'
import Compute from '@google-cloud/compute'
const projectName = 'szn-webapps', 
      applicationKeyPath = '/project/key/szn-webapps-bf289213ce2e.json'
const compute = new Compute({
  projectId: projectName,
  keyFilename: applicationKeyPath
})
const regionName = 'europe-west1', 
      zoneName = `${regionName}-c`,
      vmName = 'vm-cluster-1',
      zone = compute.zone(zoneName),
      region = compute.region(regionName),
      computeVM = zone.vm(vmName)

;(async () => {
  let address = await createStaticAddress()
  console.log(`External reserved address is ${address}`)
  let vmURL = await createVM({vmType: 'n1-standard-1'})
  console.log(`VM resource URL is ${vmURL}`)
  await assignStaticIPToVM({ addressIP: address })
  await openPort()

  /*
   * Provision machine with docker and initialize cluster manager.
   */
  // https://cloud.google.com/compute/docs/instances/connecting-to-instance#sshingcloud
  // gcloud compute ssh <vmName> // create ssh keys automatically using gcloud - will produce the keys in .ssh folder.
  // docker-machine create --driver generic --generic-ip-address=<IP> --generic-ssh-user=<user> --generic-ssh-key=<id_rsa or google_compute_engine> <vmName>
  // IMPORTANT - issue in windows when calling docker-machine from host the path should be "c:/Users/<user>/.ssh/id_rsa" not "/c/Users/<user>/.ssh/id_rsa"
  // IMPORTANT - If a machine is failling and showing error after trying to add it locally on host, it shouldn't be removed as doing so removes the cloud instance also, therefore reconfiguring by deleting the related folder in the ~/.docker/machines .
  // Docker --driver google : used for creating provisionning vms if doesn't exist.
  // Docker --driver generic : for adding & provisioning existing vms or creatng new vm & provision.
  // docker with google driver when creating vms assigns user for ssh as "docker-user" (not sure about this one), but the "gcloud compute ssh <vm>" should be called again to provision the newlly created vm with the necessary ssh to use e.g. google_compute_engine.
  // while creating ssh for existing vms using "gcloud compute ssh <vm>" assigns the host os username as ssh user.

  //[1] machine created using gcloud api
  //[2] gcloud compute ssh vm
  //[3] docker-machine create --driver generic --generic-ip-address=<> --generic-ssh-user=<windowsUser> --generic-ssh-key="c:/Users/<user>/.ssh/google_compute_engine" vm
  //[4] docker-machine provision vm
  //[5] fix issues with docker starting command: https://github.com/docker/machine/issues/4166 https://github.com/docker/machine/issues/4156#issuecomment-311955380 
  //    $ nano /etc/systemd/system/docker.service.d/10-machine.conf
  //    change "--storage-driver aufs" to "--engine-storage-driver=overlay2"
  //    $ sudo systemctl daemon-reload
  //    $ sudo systemctl -f start docker
  //[6] initialize vm

})()

async function createStaticAddress() {
  console.log('• Reserving static address.')
  // Create static ip address
  const addressName = 'node-cluster-external-ip'
  const computeAddress = region.address(addressName)
  try {
    let data = await computeAddress.create()
    const address = data[0];
    const operation = data[1];
    const apiResponse = data[2];
    await operation.promise() // long running operation
    let externalIP = (await computeAddress.get())[0].metadata.address
    let iteration = 0
    while(externalIP == undefined && iteration < 5) {
      console.log('Waiting: Trying to retrieve external IP address again...')
      await new Promise(resolve => setTimeout(resolve, 5000))
      externalIP = (await computeAddress.get())[0].metadata.address
      iteration++
    }
    if(externalIP == undefined) throw 'SZN - external IP is undefined, tried to retrive it from address resource, but it is still not assigned.'
    return externalIP // external IP
    // return apiResponse.targetLink // url link of resource
  } catch (error) {
    if(error.code == 409) {
      try {
        let address = await computeAddress.get()
        return address[0].metadata.address // external IP
        // return address[0].metadata.selfLink // get server defined resource url
      } catch (secondError) { // if other than the address already exist
        throw error
      }
    }
    throw error
  }
}

/*
  * Create VMs
  */
async function createVM({ vmType }) {
  console.log('• Creating VM.')

  // const template = await getVMTemplate({
  //   templateName: 'node-cluster-cpu1',
  //   projectName,
  //   applicationKeyPath
  // })
  // const resource = template.properties // the properties should be apparantely extracted to be used in vm creation.
  const storageDiskURL = `zones/${zoneName}/disks/datadisk-1`
  const bootImage = 'projects/debian-cloud/global/images/debian-9-stretch-v20171213'
  const vmConfig = {
    machineType: vmType,
    http: true,
    https: true,
    tags: ['docker-machine', 'docker-swarm', 'https-server', 'http-server'],
    disks: [
      { // boot image disk.
        boot: true,
        autoDelete: false,
        initializeParams: {
          sourceImage: bootImage
        }
      },
      { // attached disk
        source: storageDiskURL, // url format https://cloud.google.com/compute/docs/reference/latest/
        autoDelete: false,
        boot: false
      }
    ], 
  }

  try {
    let data = await zone.createVM(vmName, vmConfig)
    const vm = data[0];
    const apiResponse = data[2];
    const operation = data[1];
    await operation.promise() // long running operation
    return apiResponse.targetLink    
  } catch (error) {
    if(error.code == 409) {
      // // get vm using googleapis
      // // const vm = await getVM({
      // //   vmName: 'vm-cluster-1',
      // //   projectName,
      // //   applicationKeyPath, 
      // // })
      // // console.log(vm)      
      try {
        let vm = await computeVM.get()
        return vm[0].metadata.selfLink // get server defined resource url        
      } catch (secondError) {
        throw error
      }
    }
    throw error
  }
}

async function assignStaticIPToVM({ addressIP }) {
  console.log('• Assigning static ip to VM.')

  let accessConfigData = {
    "kind": "compute#accessConfig",
    "type": "ONE_TO_ONE_NAT",
    "name": "External NAT",
    "natIP": addressIP
  }

  await addAccessConfig({
    vmName,
    zoneName,
    projectName,
    applicationKeyPath, 
    accessConfigData
  })

  // let vmNetworkInterfaces = (await computeVM.getMetadata())[0].networkInterfaces[0]
  // console.log(vmNetworkInterfaces)
}

/*
  * Open required ports
  */
async function openPort() {
  console.log('• Openning ports.')

    /*
   * Create Firewall rules
   */
  await compute.firewall('docker-swarm').create({
    description: 'Allow swarm to work.',
    targetTags: [ 'docker-swarm' ], 
    allowed: [
      { IPProtocol: 'tcp', ports: ['2377'] },
      { IPProtocol: 'tcp', ports: ['7946'] },
      { IPProtocol: 'tcp', ports: ['4789'] },
      { IPProtocol: 'udp', ports: ['7946'] },
      { IPProtocol: 'udp', ports: ['4789'] },
    ]
  }).catch(error => { 
    if(error.code == 409) { console.log(error.message); return }
    throw error
  })
  await compute.firewall('default-allow-http').create({
    description: 'Allow port 80.',
    targetTags: [ 'http-server' ], 
    allowed: [ { IPProtocol: 'tcp', ports: ['80'] } ]
  }).catch(error => { 
    if(error.code == 409) { console.log(error.message); return }
    throw error
  })
  await compute.firewall('default-allow-https').create({
    description: 'Allow port 443.',
    targetTags: [ 'https-server' ], 
    allowed: [ { IPProtocol: 'tcp', ports: ['443'] } ]
  }).catch(error => { 
    if(error.code == 409) { console.log(error.message); return }
    throw error
  })
  await compute.firewall('redbird-proxy').create({
    description: 'Allow 3000 - used for Letsencrypt challenge for identity confirmation.',
    targetTags: [ 'docker-machine' ], 
    allowed: [ { IPProtocol: 'tcp', ports: ['3000'] } ]
  }).catch(error => { 
    if(error.code == 409) { console.log(error.message); return }
    throw error
  })
  await compute.firewall('jenkins-server').create({
    description: 'Allow 50000 used for jenkins agent server communication.',
    targetTags: [ 'docker-machine' ], 
    allowed: [ { IPProtocol: 'tcp', ports: ['50000'] } ]
  }).catch(error => { 
    if(error.code == 409) { console.log(error.message); return }
    throw error
  })
}