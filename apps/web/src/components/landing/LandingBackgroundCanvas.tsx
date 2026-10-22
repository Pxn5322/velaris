'use client';

import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';

interface LandingBackgroundCanvasProps {
  activePattern?: 'icosa' | 'wave' | 'galaxy';
  pulseSignal?: number;
}

export function LandingBackgroundCanvas({
  activePattern = 'icosa',
  pulseSignal = 0,
}: LandingBackgroundCanvasProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const patternRef = useRef<'icosa' | 'wave' | 'galaxy'>(activePattern);
  const coreMeshRef = useRef<THREE.Mesh | null>(null);

  useEffect(() => {
    patternRef.current = activePattern;
  }, [activePattern]);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    // 1. Scene, Camera, Renderer
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.z = 25;

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    // 2. Core 3D Geometry
    const coreGeometry = new THREE.IcosahedronGeometry(6, 2);
    const coreMaterial = new THREE.MeshBasicMaterial({
      color: 0x2563EB,
      wireframe: true,
      transparent: true,
      opacity: 0.35,
    });
    const coreMesh = new THREE.Mesh(coreGeometry, coreMaterial);
    scene.add(coreMesh);
    coreMeshRef.current = coreMesh;

    // 3. Secondary Outer Ring Geometry
    const torusGeometry = new THREE.TorusKnotGeometry(9, 1.5, 100, 16);
    const torusMaterial = new THREE.MeshBasicMaterial({
      color: 0x38BDF8,
      wireframe: true,
      transparent: true,
      opacity: 0.2,
    });
    const torusMesh = new THREE.Mesh(torusGeometry, torusMaterial);
    scene.add(torusMesh);

    // 4. Particle System
    const particleCount = 1000;
    const particleGeometry = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);
    const targetPositions = new Float32Array(particleCount * 3);

    for (let i = 0; i < particleCount * 3; i++) {
      positions[i] = (Math.random() - 0.5) * 60;
      targetPositions[i] = positions[i];
    }

    particleGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
    const particleMaterial = new THREE.PointsMaterial({
      color: isDark ? 0x38BDF8 : 0x0284C7,
      size: 0.18,
      transparent: true,
      opacity: 0.75,
    });
    const particleSystem = new THREE.Points(particleGeometry, particleMaterial);
    scene.add(particleSystem);

    // Pattern generator functions
    const setIcosaPattern = () => {
      for (let i = 0; i < particleCount; i++) {
        targetPositions[i * 3] = (Math.random() - 0.5) * 55;
        targetPositions[i * 3 + 1] = (Math.random() - 0.5) * 55;
        targetPositions[i * 3 + 2] = (Math.random() - 0.5) * 55;
      }
    };

    const setWavePattern = () => {
      const cols = 32;
      const rows = 32;
      for (let i = 0; i < particleCount; i++) {
        const x = ((i % cols) - cols / 2) * 1.5;
        const z = (Math.floor(i / cols) - rows / 2) * 1.5;
        targetPositions[i * 3] = x;
        targetPositions[i * 3 + 1] = Math.sin(x * 0.4) * 3 - 4;
        targetPositions[i * 3 + 2] = z;
      }
    };

    const setGalaxyPattern = () => {
      const arms = 3;
      for (let i = 0; i < particleCount; i++) {
        const r = Math.random() * 22;
        const armIndex = i % arms;
        const theta = r * 0.3 + armIndex * ((2 * Math.PI) / arms);
        targetPositions[i * 3] = Math.cos(theta) * r;
        targetPositions[i * 3 + 1] = (Math.random() - 0.5) * 4;
        targetPositions[i * 3 + 2] = Math.sin(theta) * r;
      }
    };

    // Listen to pattern change events
    const applyPattern = (mode: 'icosa' | 'wave' | 'galaxy') => {
      patternRef.current = mode;
      if (mode === 'icosa') setIcosaPattern();
      else if (mode === 'wave') setWavePattern();
      else if (mode === 'galaxy') setGalaxyPattern();
    };

    const handleCustomPattern = (e: Event) => {
      const detail = (e as CustomEvent<'icosa' | 'wave' | 'galaxy'>).detail;
      if (detail) applyPattern(detail);
    };

    window.addEventListener('velaris:pattern', handleCustomPattern);
    applyPattern(patternRef.current);

    // Listen to theme changes to update particle color
    const observer = new MutationObserver(() => {
      const dark = document.documentElement.getAttribute('data-theme') !== 'light';
      particleMaterial.color.setHex(dark ? 0x38BDF8 : 0x0284C7);
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    // 5. Scroll Interpolation Logic
    let currentScrollProgress = 0;
    let targetScrollProgress = 0;

    const updateScrollFraction = () => {
      const maxScroll = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
      targetScrollProgress = Math.min(Math.max(window.scrollY / maxScroll, 0), 1);
    };

    const handleResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
      updateScrollFraction();
    };

    window.addEventListener('scroll', updateScrollFraction, { passive: true });
    window.addEventListener('resize', handleResize);
    updateScrollFraction();

    // 6. Animation Render Loop
    let animationFrameId: number;
    const clock = new THREE.Clock();

    const renderLoop = () => {
      animationFrameId = requestAnimationFrame(renderLoop);

      const time = clock.getElapsedTime();

      currentScrollProgress += (targetScrollProgress - currentScrollProgress) * 0.08;

      camera.position.z = 25 - currentScrollProgress * 8;
      camera.position.y = Math.sin(currentScrollProgress * Math.PI) * 4;

      coreMesh.rotation.x = time * 0.2 + currentScrollProgress * Math.PI * 2;
      coreMesh.rotation.y = time * 0.3 + currentScrollProgress * Math.PI;

      torusMesh.rotation.x = -time * 0.15 + currentScrollProgress * Math.PI;
      torusMesh.rotation.z = time * 0.2;

      // Morph particles smoothly towards targetPositions
      const currentPos = particleGeometry.attributes.position.array as Float32Array;
      let needsUpdate = false;
      for (let i = 0; i < particleCount * 3; i++) {
        const diff = targetPositions[i] - currentPos[i];
        if (Math.abs(diff) > 0.001) {
          currentPos[i] += diff * 0.08;
          needsUpdate = true;
        }
      }

      if (patternRef.current === 'wave') {
        for (let i = 0; i < particleCount; i++) {
          const x = currentPos[i * 3];
          currentPos[i * 3 + 1] = Math.sin(time * 2 + x * 0.5 + currentScrollProgress * 10) * 2 - 4;
        }
        needsUpdate = true;
      } else if (patternRef.current === 'galaxy') {
        particleSystem.rotation.y = time * 0.2 + currentScrollProgress * Math.PI * 2;
      } else {
        particleSystem.rotation.y = time * 0.05 + currentScrollProgress * Math.PI;
      }

      if (needsUpdate) {
        particleGeometry.attributes.position.needsUpdate = true;
      }

      renderer.render(scene, camera);
    };

    renderLoop();

    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener('scroll', updateScrollFraction);
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('velaris:pattern', handleCustomPattern);
      observer.disconnect();
      coreGeometry.dispose();
      coreMaterial.dispose();
      torusGeometry.dispose();
      torusMaterial.dispose();
      particleGeometry.dispose();
      particleMaterial.dispose();
      renderer.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };
  }, []);

  // Handle pulse signal
  useEffect(() => {
    if (!pulseSignal || !coreMeshRef.current) return;
    const mesh = coreMeshRef.current;
    let frame = 0;
    const totalFrames = 30;
    const animatePulse = () => {
      frame++;
      const progress = frame / totalFrames;
      // Spring pulse curve
      const scale = 1 + Math.sin(progress * Math.PI) * 0.45;
      mesh.scale.set(scale, scale, scale);
      if (frame < totalFrames) {
        requestAnimationFrame(animatePulse);
      } else {
        mesh.scale.set(1, 1, 1);
      }
    };
    animatePulse();
  }, [pulseSignal]);

  return <div id="webgl-container" ref={mountRef} aria-hidden="true" />;
}
