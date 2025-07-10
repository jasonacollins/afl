#!/usr/bin/env python3
"""Visualize optimization diagnostics"""

import json
import matplotlib.pyplot as plt
import pandas as pd
import argparse

def visualize_diagnostics(diagnostics_file='optimization_diagnostics.json'):
    """Create visualizations from optimization diagnostics"""
    
    with open(diagnostics_file, 'r') as f:
        diagnostics = json.load(f)
    
    # Create figure with subplots
    fig, axes = plt.subplots(2, 2, figsize=(15, 10))
    fig.suptitle('Optimization Diagnostics', fontsize=16)
    
    # 1. Score convergence
    ax = axes[0, 0]
    iterations = [h['iteration'] for h in diagnostics['iteration_history']]
    scores = [h['score'] for h in diagnostics['iteration_history']]
    best_scores = []
    current_best = float('inf')
    for score in scores:
        current_best = min(current_best, score)
        best_scores.append(current_best)
    
    ax.plot(iterations, scores, 'o', alpha=0.3, label='All scores')
    ax.plot(iterations, best_scores, 'r-', linewidth=2, label='Best so far')
    ax.set_xlabel('Iteration')
    ax.set_ylabel('Score')
    ax.set_title('Score Convergence')
    ax.legend()
    ax.grid(True, alpha=0.3)
    
    # 2. Parameter evolution
    ax = axes[0, 1]
    param_evolution = diagnostics['convergence_metrics']['parameter_evolution']
    for i, (param, stats) in enumerate(param_evolution.items()):
        if param in ['k_factor', 'default_home_advantage', 'interstate_home_advantage']:
            param_values = []
            for h in diagnostics['iteration_history']:
                param_values.append(h['parameters'].get(param, 0))
            ax.plot(iterations, param_values, label=param, alpha=0.7)
    
    ax.set_xlabel('Iteration')
    ax.set_ylabel('Parameter Value')
    ax.set_title('Key Parameter Evolution')
    ax.legend()
    ax.grid(True, alpha=0.3)
    
    # 3. Constraint violations
    ax = axes[1, 0]
    if diagnostics['constraint_violations']:
        violation_iters = [v['iteration'] for v in diagnostics['constraint_violations']]
        violation_counts = [len(v['violations']) for v in diagnostics['constraint_violations']]
        ax.bar(violation_iters, violation_counts, color='red', alpha=0.7)
        ax.set_xlabel('Iteration')
        ax.set_ylabel('Number of Violations')
        ax.set_title('Constraint Violations')
    else:
        ax.text(0.5, 0.5, 'No constraint violations', ha='center', va='center')
        ax.set_title('Constraint Violations')
    
    # 4. Improvement rate
    ax = axes[1, 1]
    if diagnostics['convergence_metrics']['best_score_history']:
        improvement_iters = [h['iteration'] for h in diagnostics['convergence_metrics']['best_score_history']]
        improvements = [h['improvement'] for h in diagnostics['convergence_metrics']['best_score_history']]
        ax.plot(improvement_iters, improvements, 'g-', linewidth=2)
        ax.axhline(y=0, color='k', linestyle='--', alpha=0.5)
        ax.set_xlabel('Iteration')
        ax.set_ylabel('Improvement Rate')
        ax.set_title('Optimization Improvement Rate')
        ax.grid(True, alpha=0.3)
    
    plt.tight_layout()
    plt.savefig('optimization_diagnostics.png', dpi=300, bbox_inches='tight')
    plt.show()
    
    # Print summary statistics
    print("\n" + "="*60)
    print("OPTIMIZATION SUMMARY STATISTICS")
    print("="*60)
    
    print(f"\nTotal iterations: {diagnostics['summary']['total_iterations']}")
    print(f"Total time: {diagnostics['summary']['total_time_seconds']/60:.1f} minutes")
    print(f"Best score: {diagnostics['summary']['best_score']:.6f}")
    print(f"Constraint violations: {diagnostics['summary']['total_constraint_violations']}")
    print(f"Plateau detected: {diagnostics['summary']['plateau_detected']}")
    
    # Parameter statistics
    print("\nParameter ranges explored:")
    for param, stats in param_evolution.items():
        print(f"  {param}:")
        print(f"    Range: [{stats['min']:.4f}, {stats['max']:.4f}]")
        print(f"    Final: {stats['final']:.4f} ({stats['trend']})")

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Visualize optimization diagnostics')
    parser.add_argument('--diagnostics-file', type=str, 
                       default='elo_optimization_diagnostics.json',
                       help='Path to diagnostics JSON file')
    
    args = parser.parse_args()
    visualize_diagnostics(args.diagnostics_file)