/**
 * VELARIS Landing Page - Three.js Background Animation
 * Version: 1.0.0
 */

(function initThreeBackground() {
  'use strict';
  
  const canvas = document.getElementById('three-canvas');
  if (!canvas) return;
  
  // Check if THREE is available
  if (typeof THREE === 'undefined') {
    console.warn('THREE.js not loaded. Background animation disabled.');
    return;
  }
  
  // Scene setup
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
  camera.position.z = 400;
  
  const renderer = new THREE.WebGLRenderer({ 
    canvas: canvas, 
    alpha: true, 
    antialias: true 
  });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  
  // Particle configuration
  const PARTICLE_COUNT = 140;
  const BOUNDARY_X = 500;
  const BOUNDARY_Y = 500;
  const BOUNDARY_Z = 300;
  const CONNECTION_DISTANCE = 120;
  
  // Create Particle Grid
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(PARTICLE_COUNT * 3);
  const velocities = [];
  
  for (let i = 0; i < PARTICLE_COUNT; i++) {
    positions[i * 3] = (Math.random() - 0.5) * 1000;
    positions[i * 3 + 1] = (Math.random() - 0.5) * 1000;
    positions[i * 3 + 2] = (Math.random() - 0.5) * 600;
    
    velocities.push({
      x: (Math.random() - 0.5) * 0.4,
      y: (Math.random() - 0.5) * 0.4,
      z: (Math.random() - 0.5) * 0.2
    });
  }
  
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  
  // Particle Material
  const pMaterial = new THREE.PointsMaterial({
    color: 0x6366F1,
    size: 3.5,
    transparent: true,
    opacity: 0.8,
    blending: THREE.AdditiveBlending
  });
  
  const particleSystem = new THREE.Points(geometry, pMaterial);
  scene.add(particleSystem);
  
  // Lines Material
  const lineMaterial = new THREE.LineBasicMaterial({
    color: 0x06B6D4,
    transparent: true,
    opacity: 0.15,
    blending: THREE.AdditiveBlending
  });
  
  const lineGeometry = new THREE.BufferGeometry();
  const linePositions = new Float32Array(PARTICLE_COUNT * PARTICLE_COUNT * 6);
  lineGeometry.setAttribute('position', new THREE.BufferAttribute(linePositions, 3));
  const lineMesh = new THREE.LineSegments(lineGeometry, lineMaterial);
  scene.add(lineMesh);
  
  // Mouse Interaction
  let mouseX = 0;
  let mouseY = 0;
  let targetX = 0;
  let targetY = 0;
  
  const handleMouseMove = (e) => {
    mouseX = (e.clientX - window.innerWidth / 2) * 0.05;
    mouseY = (e.clientY - window.innerHeight / 2) * 0.05;
  };
  
  const handleResize = () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  };
  
  window.addEventListener('mousemove', handleMouseMove);
  window.addEventListener('resize', handleResize);
  
  // Animation loop
  let animationId;
  function animate() {
    animationId = requestAnimationFrame(animate);
    
    targetX += (mouseX - targetX) * 0.05;
    targetY += (mouseY - targetY) * 0.05;
    
    camera.position.x = targetX;
    camera.position.y = -targetY;
    camera.lookAt(scene.position);
    
    const pos = particleSystem.geometry.attributes.position.array;
    let lineVertexIndex = 0;
    
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      pos[i * 3] += velocities[i].x;
      pos[i * 3 + 1] += velocities[i].y;
      pos[i * 3 + 2] += velocities[i].z;
      
      // Boundary checks
      if (pos[i * 3] < -BOUNDARY_X || pos[i * 3] > BOUNDARY_X) velocities[i].x *= -1;
      if (pos[i * 3 + 1] < -BOUNDARY_Y || pos[i * 3 + 1] > BOUNDARY_Y) velocities[i].y *= -1;
      if (pos[i * 3 + 2] < -BOUNDARY_Z || pos[i * 3 + 2] > BOUNDARY_Z) velocities[i].z *= -1;
      
      // Connect nearby particles
      for (let j = i + 1; j < PARTICLE_COUNT; j++) {
        const dx = pos[i * 3] - pos[j * 3];
        const dy = pos[i * 3 + 1] - pos[j * 3 + 1];
        const dz = pos[i * 3 + 2] - pos[j * 3 + 2];
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        
        if (dist < CONNECTION_DISTANCE) {
          linePositions[lineVertexIndex++] = pos[i * 3];
          linePositions[lineVertexIndex++] = pos[i * 3 + 1];
          linePositions[lineVertexIndex++] = pos[i * 3 + 2];
          linePositions[lineVertexIndex++] = pos[j * 3];
          linePositions[lineVertexIndex++] = pos[j * 3 + 1];
          linePositions[lineVertexIndex++] = pos[j * 3 + 2];
        }
      }
    }
    
    particleSystem.geometry.attributes.position.needsUpdate = true;
    lineMesh.geometry.setDrawRange(0, lineVertexIndex / 3);
    lineMesh.geometry.attributes.position.needsUpdate = true;
    
    particleSystem.rotation.y += 0.0005;
    
    renderer.render(scene, camera);
  }
  
  animate();
  
  // Cleanup function for memory management
  window.addEventListener('beforeunload', () => {
    cancelAnimationFrame(animationId);
    window.removeEventListener('mousemove', handleMouseMove);
    window.removeEventListener('resize', handleResize);
    renderer.dispose();
    geometry.dispose();
    pMaterial.dispose();
    lineGeometry.dispose();
    lineMaterial.dispose();
  });
})();
